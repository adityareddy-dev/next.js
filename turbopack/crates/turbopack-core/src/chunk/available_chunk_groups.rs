use anyhow::Result;
use roaring::RoaringBitmap;
use turbo_tasks::{FxIndexSet, ResolvedVc, Vc};
use turbo_tasks_hash::hash_xxh3_hash64;

use crate::module_graph::{
    ModuleGraph,
    chunk_group_info::{ChunkGroupId, ChunkGroupKey, RoaringBitmapWrapper},
};

/// Chunk groups whose content is already available.
///
/// Whether an individual module is available is derived by intersecting this bitmap with the
/// module's chunk group membership bitmap.
///
/// The bitmap holds indices into the [`crate::module_graph::chunk_group_info::ChunkGroupInfo`] of a
/// single [`ModuleGraph`]. The same index means something entirely different in another graph, so
/// the graph is stored alongside the bitmap and every operation asserts that it matches. Use
/// [`AvailableChunkGroups::translate`] to move availability to a different graph.
#[turbo_tasks::value]
#[derive(Clone, Debug)]
pub struct AvailableChunkGroups {
    /// The module graph whose `ChunkGroupInfo` the indices in `chunk_groups` refer to.
    module_graph: ResolvedVc<ModuleGraph>,
    chunk_groups: RoaringBitmapWrapper,
}

impl AvailableChunkGroups {
    /// Panics in debug builds when `module_graph` is not the graph these chunk group indices
    /// belong to. Chunk group indices of a different graph would silently resolve to unrelated
    /// chunk groups, which drops modules from the output.
    pub fn assert_module_graph(&self, module_graph: ResolvedVc<ModuleGraph>) {
        debug_assert_eq!(
            self.module_graph, module_graph,
            "AvailableChunkGroups was created for a different ModuleGraph. Chunk group indices \
             are only valid within the ChunkGroupInfo of the graph that produced them; use \
             AvailableChunkGroups::translate to move them to another graph."
        );
    }

    /// The chunk groups that are available, for `module_graph`.
    pub fn chunk_groups(&self, module_graph: ResolvedVc<ModuleGraph>) -> &RoaringBitmapWrapper {
        self.assert_module_graph(module_graph);
        &self.chunk_groups
    }
}

#[turbo_tasks::value_impl]
impl AvailableChunkGroups {
    #[turbo_tasks::function]
    pub fn new(module_graph: ResolvedVc<ModuleGraph>, chunk_group: u32) -> Vc<Self> {
        let mut chunk_groups = RoaringBitmapWrapper::default();
        chunk_groups.insert(chunk_group);
        Self {
            module_graph,
            chunk_groups,
        }
        .cell()
    }

    /// Adds `chunk_group` to the set. Adding a chunk group that is already available is a no-op:
    /// a chunk group can be reached again further down a chunking chain, and availability is a
    /// set, not a count.
    #[turbo_tasks::function]
    pub fn with_chunk_group(
        &self,
        module_graph: ResolvedVc<ModuleGraph>,
        chunk_group: u32,
    ) -> Vc<Self> {
        self.assert_module_graph(module_graph);
        let mut chunk_groups = self.chunk_groups.clone();
        chunk_groups.insert(chunk_group);
        Self {
            module_graph: self.module_graph,
            chunk_groups,
        }
        .cell()
    }

    /// Re-expresses this availability in terms of `module_graph`'s
    /// [`crate::module_graph::chunk_group_info::ChunkGroupInfo`].
    ///
    /// Every index is mapped to its [`ChunkGroupKey`] in the source graph and back to the index of
    /// that key in the target graph. A chunk group that the target graph doesn't know is dropped,
    /// which is the conservative direction: it can only lead to a module being emitted again,
    /// never to one being omitted.
    #[turbo_tasks::function]
    pub async fn translate(&self, module_graph: ResolvedVc<ModuleGraph>) -> Result<Vc<Self>> {
        if self.module_graph == module_graph {
            return Ok(Self {
                module_graph,
                chunk_groups: self.chunk_groups.clone(),
            }
            .cell());
        }

        let from = self.module_graph.chunk_group_info().await?;
        let to = module_graph.chunk_group_info().await?;

        let mut translated = RoaringBitmap::new();
        for id in self.chunk_groups.iter() {
            if let Some(id) =
                translate_chunk_group(&from.chunk_group_keys, &to.chunk_group_keys, id)
            {
                translated.insert(id);
            }
        }

        Ok(Self {
            module_graph,
            chunk_groups: RoaringBitmapWrapper(translated),
        }
        .cell())
    }

    /// A hash of the available chunk groups, used to distinguish assets that are generated for
    /// different availability.
    ///
    /// Only meaningful together with the module graph these indices belong to.
    #[turbo_tasks::function]
    pub fn hash(&self) -> Vc<u64> {
        Vc::cell(hash_xxh3_hash64(&self.chunk_groups))
    }
}

/// Maps a chunk group index of `from` to the index of the same chunk group in `to`, or `None` when
/// `to` doesn't contain that chunk group.
///
/// Merged chunk group keys identify their parent by index, so the parent is translated first and a
/// merged group whose parent is unknown to `to` is dropped along with it.
fn translate_chunk_group(
    from: &FxIndexSet<ChunkGroupKey>,
    to: &FxIndexSet<ChunkGroupKey>,
    id: u32,
) -> Option<u32> {
    let key = from.get_index(id as usize)?;
    let key = match key {
        ChunkGroupKey::IsolatedMerged { parent, merge_tag } => ChunkGroupKey::IsolatedMerged {
            parent: ChunkGroupId::from(translate_chunk_group(from, to, **parent)? as usize),
            merge_tag: merge_tag.clone(),
        },
        ChunkGroupKey::SharedMerged { parent, merge_tag } => ChunkGroupKey::SharedMerged {
            parent: ChunkGroupId::from(translate_chunk_group(from, to, **parent)? as usize),
            merge_tag: merge_tag.clone(),
        },
        key => key.clone(),
    };
    to.get_index_of(&key).map(|id| id as u32)
}

#[cfg(test)]
mod tests {
    use turbo_rcstr::rcstr;
    use turbo_tasks::FxIndexSet;

    use crate::{
        chunk::available_chunk_groups::translate_chunk_group,
        module_graph::chunk_group_info::{ChunkGroupId, ChunkGroupKey},
    };

    fn isolated_merged(parent: usize, merge_tag: &str) -> ChunkGroupKey {
        ChunkGroupKey::IsolatedMerged {
            parent: ChunkGroupId::from(parent),
            merge_tag: merge_tag.into(),
        }
    }

    #[test]
    fn translates_chunk_groups_by_key_not_by_index() {
        // The same chunk groups, but discovered in a different order, so the indices differ.
        let from = FxIndexSet::from_iter([
            ChunkGroupKey::Entry(vec![]),
            ChunkGroupKey::SharedMultiple(vec![]),
        ]);
        let to = FxIndexSet::from_iter([
            ChunkGroupKey::SharedMultiple(vec![]),
            ChunkGroupKey::Entry(vec![]),
        ]);

        assert_eq!(translate_chunk_group(&from, &to, 0), Some(1));
        assert_eq!(translate_chunk_group(&from, &to, 1), Some(0));
    }

    #[test]
    fn translates_a_merged_group_parent_too() {
        let from = FxIndexSet::from_iter([ChunkGroupKey::Entry(vec![]), isolated_merged(0, "x")]);
        let to = FxIndexSet::from_iter([
            ChunkGroupKey::SharedMultiple(vec![]),
            ChunkGroupKey::Entry(vec![]),
            isolated_merged(1, "x"),
        ]);

        // The merged group's parent moved from index 0 to index 1, so the key only matches when
        // the parent is translated first.
        assert_eq!(translate_chunk_group(&from, &to, 1), Some(2));
    }

    #[test]
    fn drops_chunk_groups_the_target_graph_does_not_have() {
        let from = FxIndexSet::from_iter([
            ChunkGroupKey::Entry(vec![]),
            ChunkGroupKey::SharedMultiple(vec![]),
            isolated_merged(0, "x"),
            isolated_merged(1, "y"),
        ]);
        let to = FxIndexSet::from_iter([ChunkGroupKey::Entry(vec![]), isolated_merged(0, "x")]);

        // Unknown group.
        assert_eq!(translate_chunk_group(&from, &to, 1), None);
        // Known group with a known parent.
        assert_eq!(translate_chunk_group(&from, &to, 2), Some(1));
        // Merged group whose parent the target graph doesn't have.
        assert_eq!(translate_chunk_group(&from, &to, 3), None);
        // Out of range.
        assert_eq!(translate_chunk_group(&from, &to, 4), None);
    }

    #[test]
    fn rcstr_merge_tags_compare_by_value() {
        let from = FxIndexSet::from_iter([
            ChunkGroupKey::Entry(vec![]),
            isolated_merged(0, rcstr!("x").as_str()),
        ]);
        let to = FxIndexSet::from_iter([ChunkGroupKey::Entry(vec![]), isolated_merged(0, "x")]);

        assert_eq!(translate_chunk_group(&from, &to, 1), Some(1));
    }
}
