declare global {
  interface ApiClientInstance {
    _userAuthInfo: {
      UserId: string;
      AccessToken: string;
    };
    _serverInfo: {
      UserId: string;
      AccessToken: string;
    };
    _appName: string;
    [key: string]: any;
  }

  interface Window {
    ApiClient: ApiClientInstance | undefined | null;
    _serverInfo: {
      UserId: string;
      AccessToken: string;
    };
    _mediarelay_type: string;
  }

  var ApiClient: ApiClientInstance | undefined | null;
  var _mediarelay_type: string;
}

export {};
