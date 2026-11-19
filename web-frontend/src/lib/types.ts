export type UserIdentity = {
  id: number;
  provider: "email" | "github" | "wechat" | string;
  namespace: string;
  masked_subject: string;
  verified: boolean;
};

export type User = {
  id: number;
  nickname: string | null;
  avatar_url: string | null;
  profile_completed: boolean;
  email: string | null;
  email_verified: boolean;
  identities: UserIdentity[];
  is_admin: boolean;
  role: string;
  role_name: string;
  permissions: string[];
};

export type WebAuthResponse = {
  access_token: string;
  token_type: "bearer";
  expires_at: number;
  user: User;
};

export type MiniprogramAuthResponse = WebAuthResponse & {
  refresh_token: string;
};

export type OtpStartResponse = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
};

export type GithubStartResponse = {
  authorization_url: string;
  state: string;
};
