import "server-only";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { pipelineCommunities } from "./community-config";
import { parseRecipientFields, type CommunityRecipientList, type ListCommunity, type RecipientFields } from "./community-recipient-lists";

type Row = {
  community: ListCommunity; version: number; recipients: RecipientFields;
  source_dates: string[]; updated_at: Date | string;
};
export type SaveCommunityList = {
  community: ListCommunity; version: number; recipients: RecipientFields; mutationId: string; actorId: string;
};
const conflict = { ok: false as const, status: 409, error: "This list changed in another tab. Your edits are still here. Reload the saved list before making further changes." };

function publicList(row: Row): CommunityRecipientList {
  const recipients = parseRecipientFields(row.recipients);
  if (!recipients) throw new Error("The saved community contact list is invalid.");
  return { community: row.community, version: row.version, ...recipients, sourceDates: row.source_dates, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function readSharedCommunityLists(seed: () => Promise<CommunityRecipientList[]>) {
  const sql = getPipelineSql();
  const read = () => sql<Row[]>`select distinct on (community) * from pipeline.community_recipient_list_versions order by community, version desc`;
  let rows = await read();
  const communities = pipelineCommunities.filter((community) => community !== "Unassigned");
  if (rows.length !== communities.length) {
    // The private compiled source is needed only once. Never reapply it over a
    // managed list, even after deployment/restart or when its source file changes.
    const initial = await seed();
    if (initial.length !== communities.length || communities.some((community) => !initial.some((list) => list.community === community))) {
      throw new Error("Provide the compiled contact lists for all five communities before enabling shared lists.");
    }
    await sql.begin(async (tx) => {
      for (const list of initial) {
        const recipients = parseRecipientFields(list);
        if (!recipients) throw new Error("The compiled contact list is invalid.");
        await tx`insert into pipeline.community_recipient_list_versions
          (community, version, recipients, source_dates, actor_id)
          values (${list.community}, 1, ${tx.json(recipients)}, ${tx.json(list.sourceDates)}, 'community-list-import')
          on conflict (community, version) do nothing`;
      }
    });
    rows = await read();
  }
  return communities.map((community) => publicList(rows.find((row) => row.community === community)!));
}

export async function saveSharedCommunityList(input: SaveCommunityList): Promise<
  { ok: true; list: CommunityRecipientList } | { ok: false; status: number; error: string }
> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    // Serialize this community only; history and the current version are the
    // same append-only record, so a save cannot succeed without its audit trail.
    await tx`select pg_advisory_xact_lock(hashtext('pipeline-community-recipient-list'), hashtext(${input.community}))`;
    const [replay] = await tx<Row[]>`select * from pipeline.community_recipient_list_versions
      where community = ${input.community} and actor_id = ${input.actorId} and mutation_id = ${input.mutationId}::uuid`;
    if (replay) return replay.version === input.version + 1 && JSON.stringify(parseRecipientFields(replay.recipients)) === JSON.stringify(input.recipients)
      ? { ok: true as const, list: publicList(replay) } : conflict;
    const [current] = await tx<Row[]>`select * from pipeline.community_recipient_list_versions
      where community = ${input.community} order by version desc limit 1`;
    if (!current) return { ok: false as const, status: 409, error: "Load the community list before saving." };
    if (current.version !== input.version) return conflict;
    const [saved] = await tx<Row[]>`insert into pipeline.community_recipient_list_versions
      (community, version, recipients, source_dates, actor_id, mutation_id)
      values (${input.community}, ${current.version + 1}, ${tx.json(input.recipients)}, ${tx.json(current.source_dates)}, ${input.actorId}, ${input.mutationId}::uuid)
      returning *`;
    return { ok: true as const, list: publicList(saved) };
  });
}
