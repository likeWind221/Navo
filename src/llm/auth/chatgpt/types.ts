export interface ChatGPTAccount {
  readonly id: string;
  readonly label: string;
  readonly status: "pending" | "connected" | "signed-out" | "reauth-required";
  readonly email?: string;
  readonly sharing: boolean;
}

export interface ChatGPTModel {
  readonly slug: string;
  readonly displayName: string;
}

export interface AuthState {
  version: 1;
  hostId: string;
  activeId?: string;
  accounts: AccountRecord[];
}

export interface AccountRecord {
  id: string;
  label: string;
  clientId: string;
  status: ChatGPTAccount["status"];
  identity?: Identity;
  credentials?: Credentials;
}

export interface Identity {
  issuer: string;
  subject: string;
  email?: string;
}

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface TokenGrant {
  identity: Identity;
  credentials: Credentials;
}

export const AUTH_ISSUER = "https://auth.openai.com";
export const AUTH_RESOURCE = "https://api.openai.com/v1";
export const SHARING_SCOPE = "chatgpt.tokens.use.direct";
