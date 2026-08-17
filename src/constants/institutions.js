// Shared institution list — used by Settings > Accounts (tagging an account
// with its financial institution) and the Div. Income importer (parsing +
// narrowing the account dropdown by institution). Keep this the single
// source of truth for institution ids/labels so the two stay in sync.
export const INSTITUTIONS = {
  etrade: { label: "E*TRADE" },
  schwab: { label: "Charles Schwab" },
};
