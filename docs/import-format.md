# Creating an Election Notes import

Imports accept the same JSON object as an **Export All** download. Import **upserts** each supplied record by its numeric `id`: matching IDs are replaced, and other local records remain unchanged. To replace the entire database instead, use **Reset**. Import the file from **Import** in the sidebar, or paste its JSON directly.

Every import object must contain all eight array properties, even when some are empty:

```json
{
  "candidates": [],
  "issues": [],
  "stances": [],
  "facts": [],
  "stanceFacts": [],
  "firstRecords": [],
  "elections": [],
  "contests": []
}
```

For the exact schema and nullable fields, consult [`apps/election-notes/src/types.ts`](../apps/election-notes/src/types.ts) and the [public example data](../apps/election-notes/src/seed.example.ts). You can also **Export All**, edit the resulting JSON, and import it again. Each record must contain all fields defined for its type (with `null` for absent optional values); unknown fields are rejected. Each ID is a number. Reusing an existing ID **overwrites** that record rather than merging individual fields.

## Relationships

- `contests[].electionId` identifies the parent election; `contests[].candidateIds` lists candidate IDs.
- `elections[].issues` lists objects with `issueId` and `points`, referencing issues.
- `stances[].candidate` and `stances[].issue` reference candidates and issues.
- `stanceFacts[].stance` and `.fact` reference stances and facts.

Use unique IDs within each collection and include all referenced records unless those records are already present in the destination database. For portable imports, include them all. Export Selected includes directly or indirectly related records; Export All preserves the entire database, including records not linked to an election.

## AI-generated imports

Give an AI agent the link to this document, the type definitions, and the data you want converted. Ask it to return **only one JSON object** using the eight named arrays above, matching all required fields and maintaining consistent references. Inspect its output before importing, especially when IDs may already exist in your database.
