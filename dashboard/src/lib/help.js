/**
 * Short explanations shown by the "i" next to each feature. Written to say what a thing is and where it stops being
 * reliable: roles are estimates, a flag is for review, the data is synthetic.
 */
export const HELP = {
  // pages
  pageMonitor: {
    title: "Flagged rings",
    text: "The rings the system has flagged in its current data window, riskiest first. A ring is a group of accounts that high-risk accounts are linked to by payments. A flag is a reason to look closer, not a verdict. The list changes as payments arrive.",
  },
  pageAlerts: {
    title: "Alerts",
    text: "Two lists. Ring alerts: one for each of the riskiest rings. Likely-victim flags: accounts outside a ring that recently paid into it. Newest first. Nothing is sent to anyone from here.",
  },
  pageAssistant: {
    title: "Assistant",
    text: "Ask questions in plain words about the rings, accounts and alerts the system holds. Answers come from its own data through read-only lookups and say how they were produced. It detects nothing itself.",
  },
  pageAdmin: {
    title: "System",
    text: "What the service reports about itself, refreshed every few seconds: which backend is serving, how fresh its state is and how much history it holds. It rebuilds in micro-batches, so a new payment shows after the next rebuild.",
  },
  pageOversight: {
    title: "Oversight",
    text: "The overall picture without individual accounts: how many rings, how risky, how current. Counts describe what the system flags in its data window. They do not measure how much fraud exists.",
  },
  pageProtect: {
    title: "Payment protection",
    text: "Check an account before you pay it. You are told if it is linked to a flagged ring and why. Only accounts in the synthetic data can be checked, and nothing here makes or holds a payment.",
  },

  // rings and graph
  kpiRings: { title: "Rings flagged", text: "How many rings are flagged in the current window. The number changes as payments arrive and the window moves." },
  kpiRisk: {
    title: "Ring risk range",
    text: "Lowest and highest ring score, from 0 to 100. The score ranks rings against each other. It is not the chance that a ring is real, and when every ring scores high it cannot tell them apart.",
  },
  kpiVictims: {
    title: "Recent payers flagged for review",
    text: "Accounts outside a flagged ring that paid into it in the last 48 hours. They are listed so a person can decide whether to contact them. The rule has not been evaluated, and it names people who already paid, not who will pay next.",
  },
  rings: { title: "Rings", text: "Each card is one ring: its risk score, how many accounts it links, a one-line reason and how many recent payers are flagged. Select a card to see its detail." },
  ringDetail: { title: "Ring detail", text: "The selected ring: when it was first seen and flagged, the money flow between its accounts and the reasons behind its score." },
  flowGraph: {
    title: "Flow graph",
    text: "Money moving inside the ring. Payers are on the left, then collectors and pass-through accounts, and the cash-out on the right. Larger marks passed more money; the thin ring around a collector fills with its risk score. Roles are estimates. Hover an account for details, drag it to move it, and use the slider on the full ring page to replay.",
  },
  whyFlagged: {
    title: "Why flagged",
    text: "The signals that pushed the ring's score up or down, from the model's own feature contributions (SHAP). Many are absences, such as no long history, and say so with (absent).",
  },
  payments: {
    title: "Payments",
    text: "Every payment between accounts of this ring, in time order and grouped by day. Amounts mix currencies, so they are shown without a currency symbol.",
  },
  likelyVictims: {
    title: "Likely-victim flags",
    text: "Accounts that recently paid into a flagged ring. A flag is for review. The rule has not been evaluated, no warning is sent, and a flagged account may be a legitimate customer.",
  },
  ringAlerts: { title: "Ring alerts", text: "One alert for each of the riskiest rings, with its severity and the main reason. Open the ring to see the money flow." },
  neighborhood: { title: "Neighborhood", text: "The accounts this account has paid or been paid by, and the ring they belong to." },

  // administrator
  adminBackend: { title: "Backend", text: "Model means the API is scoring with the trained model. Sample data means it is serving invented examples and nothing on screen is a result." },
  adminSince: { title: "Time since the last rebuild", text: "How long ago the served state was rebuilt. It keeps growing while no new payments arrive, so a large number on an idle system is normal." },
  adminRebuild: { title: "Last rebuild took", text: "How long the last full rebuild took: features, scoring and ring detection. It is the main part of how long a new payment waits to appear." },
  adminHistory: { title: "Payments of history loaded", text: "The payments the service holds. How much history it is given changes the scores, so the number matters when comparing runs." },
  adminDetails: { title: "Details", text: "The raw fields of the API's health report, including the refresh mode, payments waiting for the next rebuild and the API address." },
  adminDeployment: { title: "What this deployment is", text: "Plain statements about what the system is built on and where it stops: synthetic data, CPU scoring, no accounts behind the API." },

  // regulator
  osBands: { title: "Rings by risk", text: "How many rings fall in each risk band. If every ring scores in one band, the bands are not informative and the screen says so." },
  osSizes: { title: "Rings by size", text: "How many rings have 2 to 4, 5 to 9, 10 to 19 and 20 or more accounts." },
  osCurrent: { title: "How current", text: "When the data in the service ends, and whether it comes from the live API or bundled samples." },
  osLimits: { title: "Limits of the evidence", text: "What the numbers on this page cannot show. Read this before quoting them." },
  osAccounts: { title: "Accounts inside flagged rings", text: "The total of accounts across all flagged rings. An account in two rings is counted twice." },

  // customer
  protectCheck: { title: "Check an account", text: "Looks the account up in the system's data. A flagged account opens a warning with the reasons. An account with no flag is not proven safe." },
  protectRecent: { title: "Your checks in this session", text: "The accounts you checked in this browser tab. They are kept in this tab only and cleared when it closes." },
  protectThink: { title: "Stop and think", text: "General advice for payments to people you met online. It does not depend on the data." },

  // assistant
  chat: {
    title: "Ask NEXUS Z",
    text: "Answers use only NEXUS Z's own data, through read-only lookups, and every answer says whether a language model or the built-in rules wrote it. Ids in answers link to their pages. It can be wrong, so check ids against the ring page.",
  },
};
