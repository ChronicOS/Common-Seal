# Minutes style guide (house template)

Source: the company's board minutes template (received 24 Oct 2026). Used by the draft built from the
meeting notes (`draftMinutes` in `src/board.ts`) and, later, by the AI minutes agent as its style guide.
Style: decisions and actions. Short; resolutions word for word; anything the records do not show is
left as a [bracketed] prompt, never guessed.

## Structure

```
DRAFT – FOR APPROVAL OF THE BOARD            (removed when the chair signs)

Company number: ACN 123 456 789
ABC Pty Ltd
(the "Company")

MINUTES of a meeting of the Board of Directors
held at [ADDRESS]
on [DATE] at [TIME]

Present:
[Name], Director (Chair)
[Name], Director

In attendance:
[Name]
[Name] (for the [item] portion of the meeting only)

Apologies:
[Name], Director

1. QUORUM AND DISCLOSURE OF INTERESTS
1.1 It was noted that a quorum was present and that the meeting had been duly convened in accordance
    with the Company's constitution.
1.2 Interests declared under section 191 of the Corporations Act 2001 (Cth) (the "Act") and the
    constitution, or: No director declared a material personal interest in the matters considered.

2. BUSINESS OF THE MEETING
2.1 It was noted that the business of the meeting was to consider: (a) ... (b) ...

3. DOCUMENTS TABLED FOR MEETING
3.1 [Board papers tabled]

4. MATTERS DISCUSSED            (key points in brief, only where notes were taken)

5. RESOLUTIONS
5.1 After careful consideration of the business of the meeting and the documents tabled, the
    directors agreed the matters below.
5.2 Accordingly IT WAS RESOLVED THAT:
    (a) [Resolution 1]; and
    (b) [Resolution 2].
    (Resolutions not passed, and matters deferred, listed separately.)

6. ACTIONS                       (owner and date for each)

7. FILING
7.1 It was resolved to arrange for all necessary and appropriate entries to be made in the books and
    registers of the Company and for the necessary forms and documents to be filed.

8. CLOSE
8.1 There being no further business, the Chair declared the meeting closed at [TIME].

………………………………
Chair
Signed as a correct record
```

## Rules for the AI minutes agent (when built)

- Follow the structure above; keep the standard wording of sections 1, 5, 7 and 8.
- Resolutions copied word for word from the papers or notes; flag any difference.
- Matters discussed: one or two sentences per item; decisions and reasons, not who said what.
- Privileged legal advice: summary only ("The board received legal advice on [matter].").
- Quorum: state it only if the attendance shows it; otherwise leave a [check quorum] prompt.
- Never invent attendees, times, figures or documents; leave a [bracketed] prompt instead.
- Use "Chair" (not "Chairman").
