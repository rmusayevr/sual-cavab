export type Role = "owner" | "member";

export type Project = {
  id: number;
  name: string;
  client_name: string;
  description: string;
  my_role: Role | null;
  created_at: string;
  updated_at: string;
};

export type Member = {
  user_id: number;
  email: string;
  name: string;
  role: Role;
  added_at: string;
};
