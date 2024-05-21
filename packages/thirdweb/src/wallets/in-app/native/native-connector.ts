import type { ThirdwebClient } from "../../../client/client.js";
import type { Account } from "../../interfaces/wallet.js";
import { oauthStrategyToAuthProvider } from "../core/authentication/index.js";
import {
  type AuthArgsType,
  type AuthLoginReturnType,
  type GetUser,
  type LogoutReturnType,
  type OauthOption,
  type PreAuthArgsType,
  type SendEmailOtpReturnType,
  UserWalletStatus,
} from "../core/authentication/type.js";
import type { InAppConnector } from "../core/interfaces/connector.js";
import {
  authEndpoint,
  customJwt,
  deleteActiveAccount,
  sendVerificationEmail,
  socialLogin,
  validateEmailOTP,
} from "./auth.js";
import { fetchUserDetails } from "./helpers/api/fetchers.js";
import { logoutUser } from "./helpers/auth/logout.js";
import { getWalletUserDetails } from "./helpers/storage/local.js";
import { getExistingUserAccount } from "./helpers/wallet/retrieval.js";

export type NativeConnectorOptions = {
  client: ThirdwebClient;
};

export class InAppNativeConnector implements InAppConnector {
  private options: NativeConnectorOptions;

  constructor(options: NativeConnectorOptions) {
    this.options = options;
  }

  async getUser(): Promise<GetUser> {
    const localData = await getWalletUserDetails(this.options.client.clientId);
    const userStatus = await fetchUserDetails({
      client: this.options.client,
      email: localData?.email,
    });
    if (userStatus.status === UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED) {
      return {
        status: userStatus.status,
        authDetails: userStatus.user.authDetails,
        walletAddress: userStatus.user.walletAddress,
        account: await this.getAccount(),
      };
    }
    if (userStatus.status === UserWalletStatus.LOGGED_IN_NEW_DEVICE) {
      return {
        status: UserWalletStatus.LOGGED_IN_WALLET_UNINITIALIZED,
        ...userStatus.user,
      };
    }
    if (userStatus.status === UserWalletStatus.LOGGED_IN_WALLET_UNINITIALIZED) {
      return {
        status: UserWalletStatus.LOGGED_IN_WALLET_UNINITIALIZED,
        ...userStatus.user,
      };
    }
    // Logged out
    return { status: userStatus.status };
  }
  getAccount(): Promise<Account> {
    return getExistingUserAccount({ client: this.options.client });
  }

  preAuthenticate(params: PreAuthArgsType): Promise<SendEmailOtpReturnType> {
    const strategy = params.strategy;
    switch (strategy) {
      case "email": {
        return this.sendVerificationEmail({ email: params.email });
      }
      case "phone":
        throw new Error("Phone authentication is not implemented yet");
      default:
        assertUnreachable(strategy);
    }
  }

  async authenticate(params: AuthArgsType): Promise<AuthLoginReturnType> {
    const strategy = params.strategy;
    switch (strategy) {
      case "email": {
        return await this.validateEmailOTP({
          email: params.email,
          otp: params.verificationCode,
          recoveryCode: params.verificationCode,
        });
      }
      case "google":
      case "facebook":
      case "apple": {
        if (!params.redirectUrl) {
          throw new Error(
            "redirectUrl deeplink is required for oauth login (ex: myApp://) - You also need add this deeplink in your allowed `Redirect URIs` under your API Key in your thirdweb dashboard: https://thirdweb.com/dashboard/settings/api-keys",
          );
        }
        const oauthProvider = oauthStrategyToAuthProvider[strategy];
        return this.socialLogin({
          provider: oauthProvider,
          redirectUrl: params.redirectUrl,
        });
      }
      case "jwt": {
        return this.customJwt({
          jwt: params.jwt,
          password: params.encryptionKey,
        });
      }
      case "auth_endpoint": {
        return this.authEndpoint({
          payload: params.payload,
          encryptionKey: params.encryptionKey,
        });
      }
      case "phone": {
        throw new Error("Phone authentication is not implemented yet");
      }
      case "passkey": {
        throw new Error("Passkey authentication is not implemented yet");
      }
      case "iframe": {
        throw new Error("iframe_email_verification is not supported in iframe");
      }
      case "iframe_email_verification": {
        throw new Error("iframe_email_verification is not supported in iframe");
      }
      default:
        assertUnreachable(strategy);
    }
  }

  private async validateEmailOTP(options: {
    email: string;
    otp: string;
    recoveryCode?: string;
  }): Promise<AuthLoginReturnType> {
    try {
      const { storedToken } = await validateEmailOTP({
        email: options.email,
        client: this.options.client,
        otp: options.otp,
        recoveryCode: options.recoveryCode,
      });
      const account = await this.getAccount();
      return {
        user: {
          status: UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED,
          account,
          authDetails: storedToken.authDetails,
          walletAddress: account.address,
        },
      };
    } catch (error) {
      console.error(`Error while validating otp: ${error}`);
      if (error instanceof Error) {
        throw new Error(`Error while validating otp: ${error.message}`);
      }
      throw new Error("An unknown error occurred while validating otp");
    }
  }

  async sendVerificationEmail(options: {
    email: string;
  }): Promise<SendEmailOtpReturnType> {
    return sendVerificationEmail({
      email: options.email,
      client: this.options.client,
    });
  }

  // TODO (rn) expose in the interface
  async deleteActiveAccount() {
    return deleteActiveAccount({ client: this.options.client });
  }

  private async socialLogin(
    oauthOption: OauthOption,
  ): Promise<AuthLoginReturnType> {
    try {
      const { storedToken } = await socialLogin(
        oauthOption,
        this.options.client,
      );
      const account = await this.getAccount();
      return {
        user: {
          status: UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED,
          account,
          authDetails: storedToken.authDetails,
          walletAddress: account.address,
        },
      };
    } catch (error) {
      console.error(
        `Error while signing in with: ${oauthOption.provider}. ${error}`,
      );
      if (error instanceof Error) {
        throw new Error(
          `Error signing in with ${oauthOption.provider}: ${error.message}`,
        );
      }
      throw new Error(
        `An unknown error occurred signing in with ${oauthOption.provider}`,
      );
    }
  }

  private async customJwt(authOptions: {
    jwt: string;
    password: string;
  }): Promise<AuthLoginReturnType> {
    try {
      const { storedToken } = await customJwt(authOptions, this.options.client);
      const account = await this.getAccount();
      return {
        user: {
          status: UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED,
          account,
          authDetails: storedToken.authDetails,
          walletAddress: account.address,
        },
      };
    } catch (error) {
      console.error(`Error while verifying auth: ${error}`);
      throw error;
    }
  }

  private async authEndpoint(authOptions: {
    payload: string;
    encryptionKey: string;
  }): Promise<AuthLoginReturnType> {
    try {
      const { storedToken } = await authEndpoint(
        authOptions,
        this.options.client,
      );
      const account = await this.getAccount();
      return {
        user: {
          status: UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED,
          account,
          authDetails: storedToken.authDetails,
          walletAddress: account.address,
        },
      };
    } catch (error) {
      console.error(`Error while verifying auth_endpoint auth: ${error}`);
      throw error;
    }
  }

  logout(): Promise<LogoutReturnType> {
    return logoutUser(this.options.client.clientId);
  }
}

function assertUnreachable(x: never): never {
  throw new Error(`Invalid param: ${x}`);
}
