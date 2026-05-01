import { describe, it, expect } from 'vitest';
import { classifyEmail } from '../../../src/agents/comms/email-filter.js';

const NO_CONTACTS = new Set<string>();

describe('classifyEmail — lead platform senders', () => {
  it('flags leads@zillow.com as lead_platform', () => {
    const result = classifyEmail('leads@zillow.com', 'New Buyer Lead', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('flags lead@facebookmail.com as lead_platform', () => {
    const result = classifyEmail('lead@facebookmail.com', 'New Lead from Facebook', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('flags noreply@redfin.com as lead_platform', () => {
    const result = classifyEmail('noreply@redfin.com', 'New inquiry', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('flags connect@homelight.com as lead_platform', () => {
    const result = classifyEmail('connect@homelight.com', 'New referral', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('handles "Name <email>" format for known lead platform', () => {
    const result = classifyEmail('Zillow Leads <leads@zillow.com>', 'New Buyer', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });
});

describe('classifyEmail — known contacts', () => {
  it('ingests email from a known contact', () => {
    const contacts = new Set(['sarah.chen@gmail.com']);
    const result = classifyEmail(
      'Sarah Chen <sarah.chen@gmail.com>',
      'Re: Westside listings',
      '',
      contacts,
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('known_contact');
    expect(result.matchedRule).toContain('sarah.chen@gmail.com');
  });

  it('is case-insensitive for contact matching', () => {
    const contacts = new Set(['sarah.chen@gmail.com']);
    const result = classifyEmail('Sarah.Chen@Gmail.COM', 'Follow up', '', contacts);
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('known_contact');
  });

  it('does not match unknown contact', () => {
    const contacts = new Set(['other@example.com']);
    const result = classifyEmail('random@unknown.com', 'Hello', '', contacts);
    expect(result.shouldIngest).toBe(false);
  });
});

describe('classifyEmail — lead subject patterns', () => {
  it('flags "New Buyer Lead" subject', () => {
    const result = classifyEmail('agent@brokerage.com', 'New Buyer Lead: John Smith', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
  });

  it('flags "showing request" in subject', () => {
    const result = classifyEmail('buyer@email.com', 'Showing Request for 123 Main St', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
  });

  it('flags "property inquiry" in subject', () => {
    const result = classifyEmail('user@email.com', 'Property Inquiry - 3bed/2bath', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
  });

  it('flags Zillow in subject line from unknown sender', () => {
    const result = classifyEmail('noreply@someplatform.com', 'Your Zillow inquiry is ready', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(true);
  });
});

describe('classifyEmail — body trigger words', () => {
  it('flags "pre-approved" in body', () => {
    const result = classifyEmail(
      'john@email.com',
      'Hello',
      'Hi, I am pre-approved for $450k and ready to buy.',
      NO_CONTACTS,
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('trigger_words');
  });

  it('flags "make an offer" in body', () => {
    const result = classifyEmail(
      'jane@email.com',
      'Question',
      'We would like to make an offer on the Brentwood property.',
      NO_CONTACTS,
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('trigger_words');
  });

  it('flags "schedule a showing" in body', () => {
    const result = classifyEmail(
      'buyer@email.com',
      'Hi',
      'Can we schedule a showing for this weekend?',
      NO_CONTACTS,
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('trigger_words');
  });

  it('only uses first 500 chars of body preview', () => {
    const longBody = 'A'.repeat(600) + ' pre-approved buyer here';
    const result = classifyEmail('x@y.com', 'Hi', longBody, NO_CONTACTS);
    // trigger word appears after 500 chars — should be ignored
    expect(result.shouldIngest).toBe(false);
    expect(result.category).toBe('ignored');
  });
});

describe('classifyEmail — ignored emails', () => {
  it('ignores newsletter from unknown sender with no signals', () => {
    const result = classifyEmail(
      'newsletter@somecompany.com',
      'Your weekly digest is ready',
      'Hi there! Here is your weekly newsletter with the latest updates.',
      NO_CONTACTS,
    );
    expect(result.shouldIngest).toBe(false);
    expect(result.category).toBe('ignored');
    expect(result.matchedRule).toBe('no_match');
  });

  it('ignores promotional email with no real estate signals', () => {
    const result = classifyEmail(
      'promo@store.com',
      '50% off sale this weekend!',
      'Shop now and save big on electronics.',
      NO_CONTACTS,
    );
    expect(result.shouldIngest).toBe(false);
    expect(result.category).toBe('ignored');
  });

  it('ignores empty email', () => {
    const result = classifyEmail('', '', '', NO_CONTACTS);
    expect(result.shouldIngest).toBe(false);
    expect(result.category).toBe('ignored');
  });
});

describe('classifyEmail — priority ordering', () => {
  it('known contact takes priority over lead platform sender check', () => {
    // Hypothetically, a contact email that also matches a lead sender pattern
    const contacts = new Set(['leads@zillow.com']);
    const result = classifyEmail('leads@zillow.com', 'Hi', '', contacts);
    expect(result.category).toBe('known_contact'); // contact rule fires first
  });
});
