export interface RawCollectionDoc {
  _id: string;
  name: string;
  category?: string;
  parentId?: string | null;
}

export interface TreeMigrationPlan {
  rootsToCreate: string[]; // names of roots that need to be created
  parentLinksToSet: Array<{ childId: string; childName: string; parentName: string }>;
  orphansToAdopt: Array<{ collectionName: string; parentName?: string }>;
}

const CAMBRIDGE_REGEX = /\bcam(?:bridge)?(?:\s+ielts)?\s*(\d{1,2})\b/i;
const VOLUME_REGEX = /\bvol(?:ume)?\s*(\d{1,2})\b/i;

export function planCollectionTreeMigration(
  collections: RawCollectionDoc[],
  examCollectionNames: string[] = [],
  adoptOrphans = false
): TreeMigrationPlan {
  const plan: TreeMigrationPlan = {
    rootsToCreate: [],
    parentLinksToSet: [],
    orphansToAdopt: [],
  };

  const existingByName = new Map<string, RawCollectionDoc>();
  for (const c of collections) {
    existingByName.set(c.name.toLowerCase().trim(), c);
  }

  // 1. Check existing collections with category that need parent linkage
  for (const col of collections) {
    if (col.parentId) continue; // already has parent
    const category = col.category?.trim();
    if (!category) continue;

    // If the collection name itself is identical to category, it's already a root candidate
    if (col.name.toLowerCase().trim() === category.toLowerCase()) {
      continue;
    }

    // Otherwise, ensure root exists or is planned
    const rootLower = category.toLowerCase();
    if (!existingByName.has(rootLower) && !plan.rootsToCreate.some((r) => r.toLowerCase() === rootLower)) {
      plan.rootsToCreate.push(category);
    }

    plan.parentLinksToSet.push({
      childId: col._id,
      childName: col.name,
      parentName: category,
    });
  }

  // 2. Orphans from exams
  if (adoptOrphans) {
    for (const name of examCollectionNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();

      if (!existingByName.has(lower) && !plan.orphansToAdopt.some((o) => o.collectionName.toLowerCase() === lower)) {
        let parentName: string | undefined;

        if (CAMBRIDGE_REGEX.test(trimmed)) {
          parentName = "Cambridge";
        } else if (VOLUME_REGEX.test(trimmed)) {
          parentName = "Vol / Actual";
        }

        if (parentName) {
          const parentLower = parentName.toLowerCase();
          if (!existingByName.has(parentLower) && !plan.rootsToCreate.some((r) => r.toLowerCase() === parentLower)) {
            plan.rootsToCreate.push(parentName);
          }
        }

        plan.orphansToAdopt.push({
          collectionName: trimmed,
          parentName,
        });
      }
    }
  }

  return plan;
}
