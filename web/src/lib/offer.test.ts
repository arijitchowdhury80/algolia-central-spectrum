import { describe, it, expect } from 'vitest';
import { extractDeepDiveOffer, deriveOfferState } from './offer';

describe('extractDeepDiveOffer', () => {
  it('returns rest unchanged when no SPECIALIST line', () => {
    expect(extractDeepDiveOffer(['a', 'b'])).toEqual({ rest: ['a', 'b'] });
  });
  it('pulls the SPECIALIST offer out and keeps its casing, tolerating whitespace/case drift', () => {
    expect(extractDeepDiveOffer([' Specialist:  go deeper ', 'follow up'])).toEqual({
      offer: 'go deeper',
      rest: ['follow up'],
    });
  });
});

describe('deriveOfferState', () => {
  it('offered=true and deepDiveQuery is the verbatim turnQuery when a SPECIALIST offer exists', () => {
    expect(deriveOfferState(['SPECIALIST: x', 'fu'], 'my question')).toEqual({
      deepDiveOffered: true,
      followUp: 'fu',
      deepDiveQuery: 'my question',
    });
  });
  it('offered=false and no deepDiveQuery when none', () => {
    expect(deriveOfferState(['fu'], 'q')).toEqual({
      deepDiveOffered: false,
      followUp: 'fu',
      deepDiveQuery: undefined,
    });
  });
});
