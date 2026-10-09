import { supabase } from "./supabase";
import type { GroupData } from "./types";

export type MeetingStatus = "scheduled" | "in_progress" | "minutes_draft" | "minutes_final";
export type AttendanceStatus = "expected" | "present" | "apology" | "absent";
export type ItemKind = "noting" | "discussion" | "decision";
export type Outcome = "passed" | "not_passed" | "deferred";

export type Meeting = {
  id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  status: MeetingStatus;
  ended_at: string | null;
  body: { id: string; name: string; entity: { id: string; name: string } };
};

export type AgendaItem = { id: string; position: number; title: string; kind: ItemKind };
export type Attendee = {
  id: string;
  capacity: string | null;
  status: AttendanceStatus;
  person: { id: string; full_name: string };
};
export type Capture = { agenda_item_id: string; notes: string; conflicts: string };
export type Resolution = { id: string; agenda_item_id: string | null; text: string; outcome: Outcome };
export type Minutes = { content: string; status: "draft" | "final"; finalised_at: string | null; finalised_by: string | null };
export type Action = {
  id: string;
  title: string;
  agenda_item_id: string | null;
  assignee_person_id: string | null;
  due_at: string | null;
  status: string;
};
export type WipeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected" | "blocked_by_hold" | "completed";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
};
export type Certificate = { id: string; subject_description: string; deleted_at: string; file_hashes: string[] };
export type Hold = { id: string; name: string; reason: string; status: "active" | "released" };
export type Person = { id: string; full_name: string; user_id: string | null };

export type MeetingDetail = {
  meeting: Meeting;
  agenda: AgendaItem[];
  attendees: Attendee[];
  captures: Capture[];
  resolutions: Resolution[];
  minutes: Minutes | null;
  actions: Action[];
  requests: WipeRequest[];
  certificates: Certificate[];
  holds: Hold[];
  onHold: boolean;
  people: Person[];
};

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  minutes_draft: "Minutes in draft",
  minutes_final: "Minutes final",
};

const MEETING_COLUMNS =
  "id, title, scheduled_at, location, status, ended_at, body:bodies(id, name, entity:entities(id, name))";

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadMeetings(organisationId: string): Promise<Meeting[]> {
  const { data, error } = await db()
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("organisation_id", organisationId)
    .order("scheduled_at", { ascending: false });
  check(error);
  return (data ?? []) as unknown as Meeting[];
}

const DEFAULT_AGENDA: { title: string; kind: ItemKind }[] = [
  { title: "Declarations of interest", kind: "noting" },
  { title: "Minutes of the previous meeting", kind: "decision" },
  { title: "Other business", kind: "discussion" },
];

const CAPACITY: Record<string, string> = {
  director: "Director",
  chair: "Chair",
  alternate_director: "Alternate director",
  secretary: "Secretary",
  public_officer: "Public officer",
};

/** Creates the meeting with a standard agenda and the entity's current officeholders as attendees. */
export async function createMeeting(
  organisationId: string,
  group: GroupData,
  entityId: string,
  title: string,
  scheduledAt: string,
  location: string,
): Promise<string> {
  const client = db();
  const bodyName = "Board of directors";
  const existing = await client.from("bodies").select("id").eq("entity_id", entityId).eq("name", bodyName).maybeSingle();
  check(existing.error);
  let bodyId = existing.data?.id as string | undefined;
  if (!bodyId) {
    const created = await client
      .from("bodies")
      .insert({ organisation_id: organisationId, entity_id: entityId, name: bodyName })
      .select("id")
      .single();
    check(created.error);
    bodyId = created.data!.id as string;
  }

  const meeting = await client
    .from("meetings")
    .insert({
      organisation_id: organisationId,
      body_id: bodyId,
      title: title.trim(),
      scheduled_at: scheduledAt,
      location: location.trim() || null,
    })
    .select("id")
    .single();
  check(meeting.error);
  const meetingId = meeting.data!.id as string;

  const agenda = await client.from("agenda_items").insert(
    DEFAULT_AGENDA.map((item, i) => ({
      organisation_id: organisationId,
      meeting_id: meetingId,
      position: i + 1,
      ...item,
    })),
  );
  check(agenda.error);

  const seen = new Set<string>();
  const attendees = group.officeholdings
    .filter((o) => o.entity_id === entityId && !o.ceased_on)
    .filter((o) => (seen.has(o.person.id) ? false : (seen.add(o.person.id), true)))
    .map((o) => ({
      organisation_id: organisationId,
      meeting_id: meetingId,
      person_id: o.person.id,
      capacity: CAPACITY[o.role] ?? null,
    }));
  if (attendees.length) check((await client.from("attendance").insert(attendees)).error);
  return meetingId;
}

export async function loadMeeting(organisationId: string, meetingId: string): Promise<MeetingDetail> {
  const client = db();
  const [meeting, agenda, attendees, captures, resolutions, minutes, actions, requests, certificates, holds, onHold, people] =
    await Promise.all([
      client.from("meetings").select(MEETING_COLUMNS).eq("id", meetingId).single(),
      client.from("agenda_items").select("id, position, title, kind").eq("meeting_id", meetingId).order("position"),
      client
        .from("attendance")
        .select("id, capacity, status, person:people(id, full_name)")
        .eq("meeting_id", meetingId)
        .order("created_at"),
      client.from("meeting_captures").select("agenda_item_id, notes, conflicts").eq("meeting_id", meetingId),
      client
        .from("resolutions")
        .select("id, agenda_item_id, text, outcome")
        .eq("meeting_id", meetingId)
        .order("created_at"),
      client
        .from("minutes")
        .select("content, status, finalised_at, finalised_by")
        .eq("meeting_id", meetingId)
        .maybeSingle(),
      client
        .from("tasks")
        .select("id, title, agenda_item_id, assignee_person_id, due_at, status")
        .eq("subject_table", "meetings")
        .eq("subject_id", meetingId)
        .order("created_at"),
      client
        .from("deletion_requests")
        .select("id, status, requested_by, requested_at, decided_by")
        .eq("subject_table", "meetings")
        .eq("subject_id", meetingId)
        .eq("scope", "meeting_captures")
        .order("requested_at", { ascending: false }),
      client
        .from("deletion_certificates")
        .select("id, subject_description, deleted_at, file_hashes")
        .eq("subject_id", meetingId)
        .order("deleted_at", { ascending: false }),
      client
        .from("legal_hold_scopes")
        .select("hold:legal_holds(id, name, reason, status)")
        .eq("subject_table", "meetings")
        .eq("subject_id", meetingId),
      client.rpc("record_on_hold", { p_org: organisationId, p_table: "meetings", p_id: meetingId }),
      client.from("people").select("id, full_name, user_id").eq("organisation_id", organisationId).order("full_name"),
    ]);
  check(
    meeting.error ??
      agenda.error ??
      attendees.error ??
      captures.error ??
      resolutions.error ??
      minutes.error ??
      actions.error ??
      requests.error ??
      certificates.error ??
      holds.error ??
      onHold.error ??
      people.error,
  );
  return {
    meeting: meeting.data as unknown as Meeting,
    agenda: (agenda.data ?? []) as AgendaItem[],
    attendees: (attendees.data ?? []) as unknown as Attendee[],
    captures: (captures.data ?? []) as Capture[],
    resolutions: (resolutions.data ?? []) as Resolution[],
    minutes: (minutes.data as Minutes | null) ?? null,
    actions: (actions.data ?? []) as Action[],
    requests: (requests.data ?? []) as WipeRequest[],
    certificates: (certificates.data ?? []) as Certificate[],
    holds: ((holds.data ?? []) as unknown as { hold: Hold | null }[]).flatMap((h) => (h.hold ? [h.hold] : [])),
    onHold: Boolean(onHold.data),
    people: (people.data ?? []) as Person[],
  };
}

export async function addAgendaItem(organisationId: string, meetingId: string, title: string, kind: ItemKind, position: number) {
  check(
    (
      await db()
        .from("agenda_items")
        .insert({ organisation_id: organisationId, meeting_id: meetingId, title: title.trim(), kind, position })
    ).error,
  );
}

export async function removeAgendaItem(id: string) {
  check((await db().from("agenda_items").delete().eq("id", id)).error);
}

export async function setAttendance(id: string, status: AttendanceStatus) {
  check((await db().from("attendance").update({ status }).eq("id", id)).error);
}

export async function addAttendee(organisationId: string, meetingId: string, fullName: string) {
  const client = db();
  const person = await client
    .from("people")
    .insert({ organisation_id: organisationId, full_name: fullName.trim(), is_external: true })
    .select("id")
    .single();
  check(person.error);
  check(
    (
      await client.from("attendance").insert({
        organisation_id: organisationId,
        meeting_id: meetingId,
        person_id: person.data!.id,
        capacity: "Invitee",
      })
    ).error,
  );
}

export async function saveCapture(organisationId: string, meetingId: string, itemId: string, notes: string, conflicts: string) {
  check(
    (
      await db()
        .from("meeting_captures")
        .upsert(
          { organisation_id: organisationId, meeting_id: meetingId, agenda_item_id: itemId, notes, conflicts },
          { onConflict: "agenda_item_id" },
        )
    ).error,
  );
}

export async function addResolution(organisationId: string, meetingId: string, itemId: string, text: string, outcome: Outcome) {
  check(
    (
      await db().from("resolutions").insert({
        organisation_id: organisationId,
        meeting_id: meetingId,
        agenda_item_id: itemId,
        text: text.trim(),
        outcome,
      })
    ).error,
  );
}

export async function addAction(
  organisationId: string,
  meetingId: string,
  itemId: string,
  title: string,
  assigneeId: string | null,
  dueOn: string | null,
) {
  check(
    (
      await db().from("tasks").insert({
        organisation_id: organisationId,
        title: title.trim(),
        subject_table: "meetings",
        subject_id: meetingId,
        agenda_item_id: itemId,
        assignee_person_id: assigneeId,
        due_at: dueOn ? new Date(`${dueOn}T17:00:00`).toISOString() : null,
      })
    ).error,
  );
}

export async function setMeetingStatus(meetingId: string, status: MeetingStatus) {
  check((await db().from("meetings").update({ status }).eq("id", meetingId)).error);
}

export async function saveMinutes(organisationId: string, meetingId: string, content: string) {
  check(
    (
      await db()
        .from("minutes")
        .upsert({ organisation_id: organisationId, meeting_id: meetingId, content }, { onConflict: "meeting_id" })
    ).error,
  );
}

export async function finaliseMinutes(meetingId: string, content: string) {
  check((await db().from("minutes").update({ content, status: "final" }).eq("meeting_id", meetingId)).error);
}

export async function requestWipe(meetingId: string) {
  check((await db().rpc("request_meeting_wipe", { p_meeting: meetingId })).error);
}

export async function decideWipe(requestId: string, status: "approved" | "rejected") {
  check((await db().from("deletion_requests").update({ status }).eq("id", requestId)).error);
}

export async function executeWipe(requestId: string) {
  check((await db().rpc("execute_meeting_wipe", { p_request: requestId })).error);
}

export async function placeHold(organisationId: string, meetingId: string, name: string, reason: string) {
  const client = db();
  const hold = await client
    .from("legal_holds")
    .insert({ organisation_id: organisationId, name: name.trim(), reason: reason.trim() })
    .select("id")
    .single();
  check(hold.error);
  check(
    (
      await client.from("legal_hold_scopes").insert({
        organisation_id: organisationId,
        legal_hold_id: hold.data!.id,
        scope_type: "record",
        subject_table: "meetings",
        subject_id: meetingId,
      })
    ).error,
  );
}

export async function releaseHold(holdId: string) {
  check(
    (await db().from("legal_holds").update({ status: "released", released_at: new Date().toISOString() }).eq("id", holdId))
      .error,
  );
}

// ---- Assurance summary and members ----

export type Decision = { id: string; text: string; outcome: Outcome; meeting: { title: string; scheduled_at: string } };
export type AssuranceSummary = { decisions: Decision[]; openActions: number; overdueActions: number; exceptions: number };

export async function loadAssurance(organisationId: string): Promise<AssuranceSummary> {
  const client = db();
  const [decisions, tasks, exceptions] = await Promise.all([
    client
      .from("resolutions")
      .select("id, text, outcome, meeting:meetings!inner(title, scheduled_at, status)")
      .eq("organisation_id", organisationId)
      .eq("meeting.status", "minutes_final")
      .order("created_at", { ascending: false }),
    client.from("tasks").select("id, due_at").eq("organisation_id", organisationId).in("status", ["open", "in_progress"]),
    client.from("authority_exceptions").select("id").eq("organisation_id", organisationId),
  ]);
  // The exceptions register arrives with the contracts migration; until then it reads as none.
  check(decisions.error ?? tasks.error);
  const open = (tasks.data ?? []) as { id: string; due_at: string | null }[];
  const now = Date.now();
  return {
    decisions: (decisions.data ?? []) as unknown as Decision[],
    openActions: open.length,
    overdueActions: open.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length,
    exceptions: (exceptions.data ?? []).length,
  };
}

export type Member = { user_id: string; role: string; is_active: boolean; name: string };

export async function loadMembers(organisationId: string): Promise<Member[]> {
  const client = db();
  const [memberships, people] = await Promise.all([
    client.from("memberships").select("user_id, role, is_active").eq("organisation_id", organisationId),
    client.from("people").select("user_id, full_name, email").eq("organisation_id", organisationId).not("user_id", "is", null),
  ]);
  check(memberships.error ?? people.error);
  const names = new Map(
    ((people.data ?? []) as { user_id: string; full_name: string; email: string | null }[]).map((p) => [
      p.user_id,
      p.email ?? p.full_name,
    ]),
  );
  return ((memberships.data ?? []) as Omit<Member, "name">[]).map((m) => ({
    ...m,
    name: names.get(m.user_id) ?? "Unknown user",
  }));
}

/** Adds the person now if they already have an account; otherwise records an invitation. */
export async function inviteMember(organisationId: string, email: string, role: string): Promise<"added" | "invited"> {
  const { data, error } = await db().rpc("invite_member", { p_org: organisationId, p_email: email, p_role: role });
  check(error);
  return data as "added" | "invited";
}

export type Invitation = { id: string; email: string; role: string; created_at: string };

export async function loadInvitations(organisationId: string): Promise<Invitation[]> {
  const { data, error } = await db()
    .from("invitations")
    .select("id, email, role, created_at")
    .eq("organisation_id", organisationId)
    .eq("status", "pending")
    .order("created_at");
  check(error);
  return (data ?? []) as Invitation[];
}

export async function revokeInvitation(id: string) {
  check((await db().from("invitations").update({ status: "revoked" }).eq("id", id)).error);
}

// ---- Minutes drafted from the meeting record ----

const SYDNEY = "Australia/Sydney";

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SYDNEY,
  });
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: SYDNEY });
}

const OUTCOME_WORD: Record<Outcome, string> = { passed: "RESOLVED", not_passed: "NOT PASSED", deferred: "DEFERRED" };

/** Builds a first draft of the minutes from attendance, notes, resolutions and actions. No AI is involved. */
export function draftMinutes(d: MeetingDetail): string {
  const names = (status: AttendanceStatus) =>
    d.attendees
      .filter((a) => a.status === status)
      .map((a) => `- ${a.person.full_name}${a.capacity ? ` (${a.capacity})` : ""}`);
  const lines: string[] = [
    `Minutes of the ${d.meeting.body.name.toLowerCase()}`,
    d.meeting.body.entity.name,
    "",
    `Meeting: ${d.meeting.title}`,
    `Held: ${formatWhen(d.meeting.scheduled_at)}`,
  ];
  if (d.meeting.location) lines.push(`Location: ${d.meeting.location}`);
  lines.push("", "Present", ...(names("present").length ? names("present") : ["- None recorded"]));
  if (names("apology").length) lines.push("", "Apologies", ...names("apology"));
  if (names("absent").length) lines.push("", "Absent", ...names("absent"));

  d.agenda.forEach((item, index) => {
    const capture = d.captures.find((c) => c.agenda_item_id === item.id);
    lines.push("", `${index + 1}. ${item.title}`);
    if (capture?.notes.trim()) lines.push(capture.notes.trim());
    if (capture?.conflicts.trim()) lines.push(`Interests declared: ${capture.conflicts.trim()}`);
    for (const r of d.resolutions.filter((x) => x.agenda_item_id === item.id))
      lines.push(`${OUTCOME_WORD[r.outcome]}: ${r.text}`);
    for (const a of d.actions.filter((x) => x.agenda_item_id === item.id)) {
      const owner = d.people.find((p) => p.id === a.assignee_person_id)?.full_name;
      const parts = [owner, a.due_at ? `due ${formatDay(a.due_at)}` : null].filter(Boolean).join(", ");
      lines.push(`Action: ${a.title}${parts ? ` (${parts})` : ""}`);
    }
  });

  lines.push("", "Close");
  lines.push(
    d.meeting.ended_at
      ? `There being no further business, the meeting closed at ${new Date(d.meeting.ended_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: SYDNEY })}.`
      : "There being no further business, the meeting closed.",
  );
  lines.push("", "Signed as a correct record:", "", "____________________", "Chair");
  return lines.join("\n");
}
