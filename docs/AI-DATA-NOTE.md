# What the AI assistant sends outside the system

Written for you and your lawyer. The assistant uses an outside AI service: Google Gemini or Anthropic Claude, whichever key is configured. Nothing is sent until the Owner turns the assistant on in Settings and ticks the confirmation.

## What is sent for each question
1. The question text typed by the user, and the recent messages of that chat (up to 12).
2. A fixed instruction text (the rules the assistant follows), today's date, the user's name and role, and the business name.
3. The **results of the lookups** the assistant asked for, for example:
   - totals (amounts given, collected, overdue, outstanding)
   - lists of customers with loan numbers, vehicle registration numbers, amounts and dates
   - customer name, customer number and **mobile number** (only when a customer is looked up)
   - document type, title, status and expiry date
   - district and state of a customer when one customer's details are looked up

Lists are capped (for example 20 to 50 rows), and long text is cut to 120 characters.

## What is never sent
- Uploaded files or images (RC, insurance, agreements, KYC): the assistant cannot open them.
- Chassis and engine numbers, addresses, passwords, login details, or the database keys.
- Anything the assistant did not look up for that question.

## What stays here
- Every question and answer is saved in the business's own database (Owner can read all chats; each employee sees their own), with the list of lookups used and the number of tokens.
- Nothing the assistant does can change a record. It has no way to run its own SQL; it can only call 12 fixed read-only lookups, each with checked inputs, each running with the signed-in person's own access.

## Questions to settle before real customer data is used
- Does the provider keep the data, for how long, and is it used to train models? (Check the provider's current commercial terms and data-retention settings, and whether a zero-retention arrangement is available.)
- Where is the data processed, and does that fit what your lawyer advises for customer information under the DPDP Act?
- Does the financier need to tell customers in their privacy notice that a service provider processes their data?
- Who in the business may use the assistant? (Employees need the "Use the AI assistant" permission; the Owner can switch the whole assistant off at any time.)

Until these are answered, use the assistant only with made-up data.

## If you use Google Gemini's free tier
- Google's terms for its free ("unpaid") Gemini API services say that what you submit and what the model returns may be used to improve Google's products, that human reviewers may read it, and that sensitive, confidential or personal information should not be submitted. Customer names, mobile numbers and loan amounts are exactly that, so **the free tier is for made-up data only**.
- Google's terms for **paid** use say the data is not used to improve its products, and that switching on Cloud Billing for a project makes all use of that project count as paid for data purposes, even inside the free quota.
- These terms change. Read Google's current "Gemini API Additional Terms of Service" and pricing pages before deciding, and ask your lawyer. Set `GEMINI_TIER=paid` only after billing is on and you have read them; the setting only hides the warning, it does not change what Google does.
