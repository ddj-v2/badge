import {
    Context, ForbiddenError, Handler, Schema, Service, superagent, SystemModel, TokenModel, UserFacingError, ValidationError
} from 'hydrooj';

const icon = '<span class="autherlist__icon icon icon-qq"></span>';

export default class LoginWithQQService extends Service {
    static inject = ['oauth'];
    static Config = Schema.object({
        id: Schema.string().description('QQ互联 App ID').required(),
        secret: Schema.string().description('QQ互联 App Key').role('secret').required(),
        canRegister: Schema.boolean().default(true),
    }).i18n({ en: 'Login with QQ', zh: '使用 QQ 登录' });

    constructor(ctx: Context, config: ReturnType<typeof LoginWithQQService.Config>) {
        super(ctx, 'oauth.qq');

        ctx.oauth.provide('qq', {
            text: '使用 QQ 登录',
            name: 'QQ OpenID',
            icon,
            canRegister: config.canRegister,
            callback: async function callback({ state, code }) {
                const s = await TokenModel.get(state, TokenModel.TYPE_OAUTH);
                if (!s) throw new ValidationError('token');
                const url = SystemModel.get('server.url');

                // 1. 获取access_token
                const res = await superagent.post('https://graph.qq.com/oauth2.0/token')
                    .send({
                        grant_type: 'authorization_code',
                        client_id: config.id,
                        client_secret: config.secret,
                        code,
                        redirect_uri: `${url}oauth/qq/callback`,
                        state,
                    })
                    .set('accept', 'application/json');

                const tokenParams = new URLSearchParams(res.text);
                const accessToken = tokenParams.get('access_token');

                if (res.body.error) {
                    throw new UserFacingError(
                        res.body.error, res.body.error_description, res.body.error_uri,
                    );
                }

                // 2. 获取OpenID
                const openIdRes = await superagent.get('https://graph.qq.com/oauth2.0/me')
                    .query({
                        access_token: accessToken,
                        fmt: 'json',
                    });

                const openIdData = JSON.parse(openIdRes.text.replace(/callback\(|\);?$/g, ''));
                const openId = openIdData.openid;

                if (!openId) {
                    throw new UserFacingError('Failed to get OpenID');
                }

                // 3. 获取用户信息
                const userInfo = await superagent.get('https://graph.qq.com/user/get_user_info')
                    .query({
                        access_token: accessToken,
                        oauth_consumer_key: config.id,
                        openid: openId,
                    });

                if (userInfo.body.ret !== 0) {
                    throw new UserFacingError(`QQ API Error: ${userInfo.body.msg}`);
                }

                const ret = {
                    _id: openId.toString(),
                    email: `${openId}@qq.local`, // QQ不提供邮箱，使用临时邮箱
                    uname: [userInfo.body.nickname].filter((i) => i),
                    avatar: `url:${userInfo.body.figureurl_qq_2 || userInfo.body.figureurl_qq_1}`,
                    set: {
                        qq: openId.toString()
                    }
                };

                await TokenModel.del(s._id, TokenModel.TYPE_OAUTH);
                if (!ret.email) throw new ForbiddenError("You don't have a verified email.");
                return ret;
            },
            get: async function get(this: Handler) {
                const [state] = await TokenModel.add(TokenModel.TYPE_OAUTH, 600, { redirect: this.request.referer });
                const url = SystemModel.get('server.url');
                const redirectUri = `${url}oauth/qq/callback`;
		this.response.redirect = `https://graph.qq.com/oauth2.0/authorize?client_id=${config.id}&state=${state}&scope=get_user_info&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;
            },
        });
    }
}