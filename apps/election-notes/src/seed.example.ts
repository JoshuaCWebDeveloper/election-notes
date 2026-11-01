import type { Database } from './types';

export const seedData: Database = {
  candidates: [
    {
      id: 1,
      firstName: 'Alex',
      middleName: null,
      lastName: 'Example'
    },
    {
      id: 2,
      firstName: 'Jordan',
      middleName: 'Q',
      lastName: 'Sample'
    }
  ],
  issues: [
    {
      id: 1,
      name: 'Example Infrastructure',
      description: 'Dummy issue for local development seeds.'
    },
    {
      id: 2,
      name: 'Example Education',
      description: 'Second dummy issue with a different election weight.'
    }
  ],
  stances: [
    {
      id: 1,
      date_created: '2024-01-01T12:00:00.000Z',
      date_updated: null,
      title: 'Mostly aligned',
      candidate: 1,
      issue: 1,
      rating: 80,
      confidence: 75,
      description: 'Dummy stance showing a candidate-to-issue relationship.'
    },
    {
      id: 2,
      date_created: '2024-01-02T12:00:00.000Z',
      date_updated: null,
      title: 'Partially aligned',
      candidate: 2,
      issue: 1,
      rating: 55,
      confidence: 60,
      description: 'Another dummy stance for comparison.'
    }
  ],
  facts: [
    {
      id: 1,
      date_created: '2024-01-03T12:00:00.000Z',
      date_updated: null,
      Summary: 'Dummy source note',
      description: 'A markdown-capable note can include **formatting** and links.'
    }
  ],
  stanceFacts: [
    {
      id: 1,
      stance: 1,
      fact: 1
    }
  ],
  firstRecords: [
    {
      id: 1,
      status: 'draft',
      sort: 1,
      user_created: null,
      date_created: '2024-01-04T12:00:00.000Z',
      user_updated: null,
      date_updated: null,
      name: 'Example first record'
    }
  ],
  elections: [
    {
      id: 1,
      name: 'Example Local Election',
      date: '2024-11-05',
      date_updated: '2024-01-05T12:00:00.000Z',
      description: 'Dummy election showing candidate membership and election-specific issue points.',
      issues: [
        {
          issueId: 1,
          points: 125
        },
        {
          issueId: 2,
          points: 75
        }
      ]
    }
  ],
  contests: [
    {
      id: 1,
      electionId: 1,
      name: 'Example Local Election contest',
      notes: null,
      candidateIds: [1, 2],
      selectedCandidateIds: []
    }
  ]
};
