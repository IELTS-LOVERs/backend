import { describe, expect, it } from "vitest";
import { planCollectionTreeMigration } from "./migrate-collections-to-tree.js";

describe("planCollectionTreeMigration", () => {
  it("creates parent root and links existing collections by their legacy category", () => {
    const collections = [
      {
        _id: "c1",
        name: "Cambridge IELTS 18",
        category: "Cambridge",
      },
      {
        _id: "c2",
        name: "Cambridge IELTS 19",
        category: "Cambridge",
      },
    ];

    const plan = planCollectionTreeMigration(collections);
    expect(plan.rootsToCreate).toEqual(["Cambridge"]);
    expect(plan.parentLinksToSet).toHaveLength(2);
    expect(plan.parentLinksToSet[0].childName).toBe("Cambridge IELTS 18");
    expect(plan.parentLinksToSet[0].parentName).toBe("Cambridge");
  });

  it("reuses existing root if collection with category name already exists", () => {
    const collections = [
      {
        _id: "root1",
        name: "Cambridge",
        category: "Cambridge",
      },
      {
        _id: "c1",
        name: "Cambridge IELTS 18",
        category: "Cambridge",
      },
    ];

    const plan = planCollectionTreeMigration(collections);
    expect(plan.rootsToCreate).toHaveLength(0);
    expect(plan.parentLinksToSet).toHaveLength(1);
    expect(plan.parentLinksToSet[0].childName).toBe("Cambridge IELTS 18");
  });

  it("adopts exam collection names that have no collection doc when adoptOrphans is enabled", () => {
    const collections = [
      {
        _id: "root1",
        name: "Cambridge",
      },
    ];

    const examNames = ["Cambridge 8", "Personalised Materials", "Vol 2"];
    const plan = planCollectionTreeMigration(collections, examNames, true);

    expect(plan.rootsToCreate).toContain("Vol / Actual");
    expect(plan.orphansToAdopt).toEqual([
      { collectionName: "Cambridge 8", parentName: "Cambridge" },
      { collectionName: "Personalised Materials", parentName: undefined },
      { collectionName: "Vol 2", parentName: "Vol / Actual" },
    ]);
  });
});
