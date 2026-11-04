/**
 * Labelled fact pairs for calibrating the judge.
 *
 * Deliberately unbalanced in the hard direction, because the two failure modes are
 * not equally expensive: a **missed** contradiction leaves two facts stored (the
 * old behaviour), while a **false** contradiction deletes a true fact. So the set
 * carries plenty of hard negatives — pairs that share almost all of their words and
 * still do not conflict ("uses Postgres" vs "uses Postgres 16.3 on RDS") — and hard
 * positives whose surface wording barely overlaps ("lives in Brooklyn" vs "moved to
 * Queens").
 *
 * `simHint` is not used by the code; it records what the pair is for.
 */
export type Expected = 'contradiction' | 'duplicate' | 'refines' | 'unrelated';

export type Pair = {
  old: string;
  new: string;
  expected: Expected;
  kind: 'hard-positive' | 'hard-negative' | 'clear';
  why: string;
};

export const PAIRS: Pair[] = [
  // ---- contradictions: the fact changed -------------------------------------
  { old: 'User lives in Brooklyn.', new: 'User moved to Queens in March 2026.', expected: 'contradiction', kind: 'hard-positive', why: 'a move falsifies the address' },
  { old: 'User works at Acme as a backend engineer.', new: 'User now works at Stripe as a staff engineer.', expected: 'contradiction', kind: 'hard-positive', why: 'employer changed' },
  { old: 'User cancelled the Hetzner account last week.', new: 'User runs three servers on Hetzner.', expected: 'contradiction', kind: 'hard-positive', why: 'account gone' },
  { old: 'The gateway listens on port 8080.', new: 'The gateway now listens on port 9527.', expected: 'contradiction', kind: 'clear', why: 'config changed' },
  { old: 'User prefers light mode in every editor.', new: 'User prefers dark mode in every editor.', expected: 'contradiction', kind: 'clear', why: 'preference reversed' },
  { old: 'User has three children.', new: 'User has two children.', expected: 'contradiction', kind: 'clear', why: 'a count that cannot both be true' },
  { old: 'The boardroom has six seats.', new: 'The boardroom was cut to four seats.', expected: 'contradiction', kind: 'hard-positive', why: 'same subject, new count' },
  { old: 'User is allergic to peanuts.', new: 'User is no longer allergic to peanuts.', expected: 'contradiction', kind: 'clear', why: 'negation of the same fact' },
  { old: 'The ledger is written by the gateway process.', new: 'The ledger is written by a separate worker now.', expected: 'contradiction', kind: 'hard-positive', why: 'same role, different owner' },
  { old: 'User charges $50 per month for the Pro tier.', new: 'Pro is free from January.', expected: 'contradiction', kind: 'hard-positive', why: 'price replaced' },

  // ---- duplicates: same fact, different words -------------------------------
  { old: 'User prefers terse replies with numbers.', new: 'User’s answers should be short and numeric.', expected: 'duplicate', kind: 'hard-positive', why: 'same preference, rephrased' },
  { old: 'Runs a two-core VM for the gateway.', new: 'The gateway runs on a VM with two cores.', expected: 'duplicate', kind: 'clear', why: 'word order only' },
  { old: 'Every research output must be cited.', new: 'Produces research that cites its sources.', expected: 'duplicate', kind: 'hard-positive', why: 'active vs passive' },
  { old: 'Deploys to Akash.', new: 'Akash is where the deployments run.', expected: 'duplicate', kind: 'clear', why: 'same fact, reordered' },
  { old: 'User timezone is America/New_York.', new: 'The user is in Eastern time.', expected: 'duplicate', kind: 'hard-positive', why: 'two spellings of one zone' },

  // ---- refinements: compatible, more specific (the hard negatives) ----------
  { old: 'User uses Postgres.', new: 'User’s Postgres is 16.3, managed by RDS.', expected: 'refines', kind: 'hard-negative', why: 'narrows the same fact' },
  { old: 'The build failed with ERR_4021.', new: 'The alert was ERR_4021 from the ledger writer.', expected: 'refines', kind: 'hard-negative', why: 'same error, more location' },
  { old: 'User is based in New York.', new: 'User is based in New York and travels monthly.', expected: 'refines', kind: 'hard-negative', why: 'adds detail' },
  { old: 'Runs the gateway on a VM.', new: 'Runs the gateway on a two-core VM with 7 GB of RAM.', expected: 'refines', kind: 'hard-negative', why: 'adds hardware detail' },
  { old: 'User prefers dark mode.', new: 'User prefers dark mode and a larger font.', expected: 'refines', kind: 'hard-negative', why: 'adds a preference, contradicts none' },
  { old: 'The queue is processed in order.', new: 'The queue is processed in order with one retry on failure.', expected: 'refines', kind: 'hard-negative', why: 'adds a policy' },
  { old: 'User pays for the Pro tier.', new: 'User pays $50 a month for the Pro tier.', expected: 'refines', kind: 'hard-negative', why: 'names the amount' },
  { old: 'The boardroom has six seats.', new: 'The boardroom has six seats and a chair.', expected: 'refines', kind: 'hard-negative', why: 'adds a role' },

  // ---- unrelated: different subjects ---------------------------------------
  { old: 'User prefers tabs over spaces.', new: 'User runs a Postgres database.', expected: 'unrelated', kind: 'clear', why: 'different subjects' },
  { old: 'The boardroom has six seats.', new: 'The gateway fails over after three attempts.', expected: 'unrelated', kind: 'clear', why: 'different subsystems' },
  { old: 'User drinks black coffee.', new: 'User writes Go and TypeScript.', expected: 'unrelated', kind: 'clear', why: 'nothing in common' },
  { old: 'The ledger records cost per attempt.', new: 'The boardroom publishes a waveform file.', expected: 'unrelated', kind: 'clear', why: 'different subsystems' },
  { old: 'User dislikes YAML tabs.', new: 'User likes the colour teal.', expected: 'unrelated', kind: 'clear', why: 'different topics' },
  { old: 'The voice worker speaks Kokoro.', new: 'The ledger has 118 rows.', expected: 'unrelated', kind: 'clear', why: 'different subsystems' },
];
