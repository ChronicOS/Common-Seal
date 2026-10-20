# read-contract

Reads the key details of contracts (PDF, Word .docx, text) and of online terms, for Contract Management
(migration 0067). It uses Claude Sonnet 4.5 through Amazon Bedrock with the Australian cross-region
profile, so documents are processed only in Sydney and Melbourne. AWS does not use them to train models.

A person checks every answer (shown with the words it came from) before a contract is saved.

## Set up (about 30 minutes)

1. **Switch Claude on in Bedrock.** Sign in to the AWS console and choose **Asia Pacific (Sydney)**
   ap-southeast-2 (top right). Open **Amazon Bedrock → Model access** (or "Model catalog"), find
   **Anthropic Claude Sonnet 4.5** and request access. The first time, AWS asks for a short
   Anthropic use-case form: company name, website, and "Contract register: reading key terms of our own contracts".
   Access is usually granted within minutes.
2. **Make an AWS user just for this.** IAM → Users → Create user `veraphius-bedrock` (no console access).
   Attach an inline policy (JSON tab), replacing `ACCOUNT_ID` with your 12-digit AWS account number:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ClaudeInAustraliaOnly",
         "Effect": "Allow",
         "Action": "bedrock:InvokeModel",
         "Resource": [
           "arn:aws:bedrock:ap-southeast-2:ACCOUNT_ID:inference-profile/au.anthropic.claude-sonnet-4-5-20250929-v1:0",
           "arn:aws:bedrock:ap-southeast-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
           "arn:aws:bedrock:ap-southeast-4::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0"
         ]
       }
     ]
   }
   ```

   Then **Security credentials → Create access key → "Application running outside AWS"**. Copy the two
   values straight into Supabase in the next step. Do not paste them into chat or email.
3. **Add the secrets in Supabase** (Edge Functions → Secrets):
   - `BEDROCK_ACCESS_KEY_ID`
   - `BEDROCK_SECRET_ACCESS_KEY`
   - optional `BEDROCK_REGION` (default `ap-southeast-2`) and `BEDROCK_MODEL_ID`
     (default `au.anthropic.claude-sonnet-4-5-20250929-v1:0`)
4. **Deploy** this function: Edge Functions → Deploy a new function → name `read-contract`, paste
   `index.ts`, and leave **Verify JWT ON**.
5. **Test:** Contract Management → Add contracts → drop in a sample (not a real) contract. It should
   come back in 10 to 30 seconds with answers and quotes.

## What it reads

| Field | Contracts | Online terms |
|---|---|---|
| Other party, title, what it is, what it is for | yes | yes |
| Start and end dates | yes | no |
| Termination for convenience: whether, who, notice, from when | yes | no |
| Auto-renewal, last day for notice, renewal rule | yes | no |

Online terms: the link is kept with the date it was added. No copy of the page is stored, so the
page may change later.

## Troubleshooting

| Message | What to do |
|---|---|
| "Claude is not switched on in Amazon Bedrock yet" | Step 1, in the Sydney region |
| "Amazon Bedrock did not accept the keys" | Check both secrets, and the policy in step 2 (all three resources) |
| "The Claude model was not found in this AWS region" | Check `BEDROCK_REGION` / `BEDROCK_MODEL_ID` |
| "This document is too long" | Over about 100 pages. Split it or type the details in |
| "That site does not let other systems read the page" | Save the terms as a text or PDF file and drop that in |
| "Contract reading is not set up yet" | The function is not deployed, or the secrets are missing |

Cost: about 5 to 15 cents a contract (Sonnet 4.5 on Bedrock, pay per use). There is no monthly fee.
