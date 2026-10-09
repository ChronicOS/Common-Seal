# Common Seal

Board, company secretarial and compliance on one record. This repository holds the web app and the database migrations.

## What is here

- `src/` – the web app (React, TypeScript, Vite). Sign in by email link, create an organisation, add entities with guided prompts, and see the group chart.
- `supabase/migrations/` – database schema, run in order in the Supabase SQL editor.
  - `0001_phase0_foundations.sql` – tenancy, documents, AI review, legal holds, deletion, audit log, row-level security.
  - `0002_create_organisation.sql` – lets a signed-in user create an organisation and become its owner.
  - `0003_entities.sql` – entities, ownership links, officeholders, setup prompts, and tighter table privileges.
  - `0004_board.sql` – board meetings, agenda, attendance, draft notes, resolutions, minutes that lock, the two-person wipe of draft notes, and adding members.
  - `0005_invitations.sql` – invite people by email before they have an account.
  - `0006_delegations.sql` – delegations of authority, signing rules and powers of attorney.
  - `0007_contracts.sql` – contracts, approval routing from the delegation rules, signatures, reminders and the exceptions register.
  - `0008_register.sql` – risk and compliance register at local, regional and global levels, ownership (responsible, accountable, consulted, informed) and sector templates.
  - `0009_due_diligence.sql` – third-party and customer due diligence, the contract approval gate, and the gifts and conflicts registers.
  - `0010_intercompany.sql` – intercompany arrangements: contracts between two group entities, approved and signed by each side.
  - `0011_training.sql` – training: standard library, your own modules, assignments, marked attempts and completion records.
  - `0012_workflows.sql` – workflow builder: your own step-by-step processes, runs and their evidence.
- `netlify.toml` – build settings and security headers.

## Deploying to Netlify

1. Import this repository in Netlify. Build settings are read from `netlify.toml`.
2. Add two environment variables:
   - `VITE_SUPABASE_URL` – the project URL, e.g. `https://abcd1234.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` – the publishable key (starts `sb_publishable_`)
3. Deploy, then add the site's address to the allowed redirect URLs in Supabase's authentication settings.

Only the publishable key belongs here. The secret key and database password must never be committed or added to Netlify.

## Running locally

```
cp .env.example .env.local   # then fill in the two values
npm install
npm run dev
```

## Data residency

The Supabase project must be in Sydney (`ap-southeast-2`). Netlify serves only the front-end code; no customer data is stored there. The app loads no third-party fonts or scripts.
