# Sanctions and watch-list screening (Dilisense): set-up

About 30 minutes. Afterwards, anyone in Legal, Compliance, the company secretary or an administrator can press **Screen now** on a third party in Due Diligence (organisations and individuals). VeraPhius searches Dilisense's sanctions, politically exposed persons and criminal and other watch lists, records the result, and Legal or Compliance review any possible matches.

**Before you start**

- Migration 0061 has been run and the health check passes.
- Keys go from Dilisense into Supabase through your password manager. Never into chat, email or a document.

## Step 1: Dilisense account and key (10 min)

1. Go to dilisense.com and create an account (the free plan gives 100 searches a month; no card needed).
2. In the Dilisense dashboard, copy your **API key** into your password manager.
3. Before relying on it, check which lists it covers. Dilisense's own list of sources (dashboard, or `getSourceList` in their docs) should include **Australia's DFAT Consolidated List**. If it does not, tell Claude: the screening would then need a second source for Australian sanctions.
4. Ask Dilisense for their **data processing agreement**. They are a Swiss company and say they keep no record of searches, but names (and, for individuals, date of birth and gender) do leave Australia when you screen. Your privacy notice to third parties should say so.

## Step 2: The key in Supabase (5 min)

Supabase → your project → **Edge Functions → Secrets** → add:

| Name | Value |
|---|---|
| `DILISENSE_API_KEY` | the key from step 1 |

## Step 3: The function (10 min)

1. **Edge Functions → Deploy a new function → Via editor**. Name it exactly `screen-party`.
2. Replace the sample code with all of `index.ts` from this folder. **Deploy**.
3. Leave **Verify JWT ON** for this one. (It is the opposite of the reminder function: only signed-in people can call it, and it checks their role too.)

## Step 4: Test (5 min)

1. Sign in to VeraPhius → **Settings → Integrations**. The Dilisense card should say **On**, with this month's searches used.
2. **Due Diligence → Individuals → Due diligence an individual**. Use a well-known public figure from the news, not a real business contact, for example a sanctioned foreign politician. Request it, then **Screen now**. You should see possible matches.
3. Review one as **Not this person** and one as **It is them**, each with a short reason. The PEP or sanctions check below should change to match.
4. **Save the provider's PDF report to this case**: it appears under Reports and evidence.
5. Then delete or reject that test case.

If something goes wrong, the message on screen says what. Logs: Edge Functions → screen-party → Logs.

| Message | Fix |
|---|---|
| "Screening is not set up yet: the screen-party function has not been deployed" | Step 3: name must be exactly `screen-party`. |
| "did not accept the API key" | Re-paste `DILISENSE_API_KEY` (no spaces). |
| "limit has been reached" | Monthly quota used. Upgrade the plan or wait for the month to roll over. |
| "You cannot screen this party" | Only owners, admins, the company secretary, Legal and Compliance can screen. |

## How it works (for the record)

- The browser never sees the key. The function checks the person's role using their own sign-in, runs the search, and saves the result using the server's access. Nobody can type in or edit a result; the health check confirms this.
- The **checks** follow the review: no possible matches, or all reviewed as not a match → sanctions, PEP (individuals) and other-lists checks marked clear, with a note naming the date and source. A confirmed match → that check becomes a concern immediately.
- **Adverse media is not covered** by this screening. It stays a manual check (Dilisense sells it separately; ask Claude if you want it added).
- For individuals, the date of birth and gender narrow results but never hide a listed person who has none recorded. Citizenship is deliberately not used as a filter.
- Each screen and each PDF report counts as one Dilisense search.

## Not built yet (on the list)

- **Ongoing monitoring**: Dilisense can watch screened parties and notify VeraPhius when a list changes (webhook). Needs a second function and a monthly plan with monitoring.
- **Adverse media** screening.
- **Bulk re-screening** of every third party (for example after major sanctions changes).
