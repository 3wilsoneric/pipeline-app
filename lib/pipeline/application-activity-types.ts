export type ApplicationActivityPerson = {
  id: string;
  name: string;
  email: string | null;
  last_seen_at: string | null;
  last_sign_in_at: string | null;
  sign_ins: number;
  recorded_actions: number;
};

export type ApplicationActivityEvent = {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  fields: string[];
  created_at: string;
  workspace: { id: number; name: string; deleted: boolean } | null;
};

export type ApplicationActivitySnapshot = {
  since: string;
  through: string;
  people: ApplicationActivityPerson[];
  events: ApplicationActivityEvent[];
  next_cursor: string | null;
};
