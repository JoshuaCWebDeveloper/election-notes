# Election Notes import file format

An import file is a UTF-8 JSON object containing eight named arrays. This document describes how to construct a valid file, including every required field and relationship.

## Top-level structure

All eight properties are required, even when the corresponding array is empty. No other top-level properties are allowed.

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

## Record formats

Each array contains objects with **exactly** the fields listed below. Every listed field is required **except `id`**, which may be omitted for new records. Nullable fields must still be present. `string?` means a string or `null`; `number?` means a number or `null`. Arrays must be JSON arrays. When supplied, IDs are numbers, not strings. Field names are case-sensitive (`Summary` starts with a capital S).

| Array | Required fields and types |
| --- | --- |
| `candidates` | `id?: number`, `firstName: string?`, `middleName: string?`, `lastName: string?`, `score: number?`, `confidence: number?`, `stancesCount: number?`, `confidenceScoreProduct: number?` |
| `issues` | `id?: number`, `name: string?`, `description: string?` |
| `stances` | `id?: number`, `date_created: string?`, `date_updated: string?`, `title: string?`, `candidate: number?`, `issue: number?`, `rating: number?`, `confidence: number?`, `description: string?` |
| `facts` | `id?: number`, `date_created: string?`, `date_updated: string?`, `Summary: string?`, `description: string?` |
| `stanceFacts` | `id?: number`, `stance: number?`, `fact: number?` |
| `firstRecords` | `id?: number`, `status: string`, `sort: number?`, `user_created: string?`, `date_created: string?`, `user_updated: string?`, `date_updated: string?`, `name: string?` |
| `elections` | `id?: number`, `name: string`, `date: string?`, `date_updated: string?`, `description: string?`, `issues: {issueId: number, points: number}[]` |
| `contests` | `id?: number`, `electionId: number`, `name: string`, `notes: string?`, `candidateIds: number[]` |

Dates are strings (prefer ISO 8601) or `null`; the validator does not require a particular date format. It also does not impose value ranges on numeric fields.

## IDs and relationships

For new records, omit `id` to have it generated automatically. To update an existing record, provide its numeric `id`. The same numeric ID may appear in different arrays because each array is a distinct collection. Supplied IDs must be unique within their array. Generated IDs avoid collisions with existing records and IDs supplied in the file.

- `contests[].electionId` references `elections[].id`.
- `contests[].candidateIds` contains IDs from `candidates`.
- `elections[].issues` contains objects with an `issueId` referencing `issues` and numeric `points`.
- `stances[].candidate` and `stances[].issue` reference candidates and issues.
- `stanceFacts[].stance` and `stanceFacts[].fact` reference stances and facts.

Records referenced by another record must have explicit IDs so their references can be written in the file. Only omit IDs on records that no other record in the file needs to reference (such as a standalone election or a linking record). For a self-contained import, include every referenced record and ensure all ID references agree. When imported into an existing database, a record with the same collection and ID replaces the existing record in full, so avoid accidental ID collisions.

## How to create an import file

1. Identify the elections and contests to represent. Assign unique numeric IDs to records that are referenced elsewhere in the file or that should update an existing record; omit IDs for independent new records.
2. Construct each record with all fields shown above; write `null` for unknown nullable values.
3. Fill in references between records using the chosen IDs. Include supporting candidates, issues, stances, facts, and link records as needed.
4. Assemble the eight top-level arrays. Empty collections must still be present as `[]`.
5. Serialize as valid JSON, with double-quoted property names and strings, no comments, and no trailing commas.
6. Verify every record's field names and types, uniqueness of supplied IDs, and consistency of references.

The [TypeScript data definitions](../apps/election-notes/src/types.ts) and [import validation rules](../apps/election-notes/src/services/database.ts) provide the definitive schema. The [example data](../apps/election-notes/src/seed.example.ts) contains complete sample records.
