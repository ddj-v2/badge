import {
    Context, UserModel, SettingModel, Handler, NotFoundError, ValidationError, param, PRIV, Types, query
} from 'hydrooj';
import { UserBadgeModel, BadgeModel, BadgePurchaseModel } from './model';

interface ShopBridge {
    goodsModel: {
        add: (
            name: string,
            price: number,
            num: number,
            objectId?: string,
            goodsId?: number,
            purchaseModelId?: string,
            data?: Record<string, unknown>,
            description?: string,
            redirectUrl?: string,
        ) => Promise<number | string>;
        getByObjectId: (objectId: string) => Promise<any>;
    };
    registerGoodsPurchaseModel: (
        modelId: string,
        model: {
            purchase: (
                uid: number,
                item: any,
                amount: number,
            ) => Promise<boolean | { success: boolean; message?: string }> | (boolean | { success: boolean; message?: string });
        }
    ) => void;
    registerShopManageEntry: (entry: { key: string; title: string; href: string }) => void;
}

function getShopBridge(): ShopBridge | null {
    return (global.Hydro as any)?.shopBridge || null;
}

class UserBadgeManageHandler extends Handler {
    @query('page', Types.PositiveInt, true)
    async get(domainId: string, page = 1, uid = this.user._id) {
        const [ddocs, dpcount] = await this.paginate(
            await UserBadgeModel.getMulti(uid),
            page,
            20
        );
        for (const ddoc of ddocs) {
            ddoc.badge = await BadgeModel.get(ddoc.badgeId);
        }
        const udoc = await UserModel.getById(domainId, uid);
        this.response.template = 'badge_mybadge.html';
        this.response.body = { ddocs, dpcount, page, udoc }
    }
    
    @param('badgeId', Types.PositiveInt)
    async postEnable(domainId: string, badgeId: number) {
        await UserBadgeModel.sel(this.user._id, badgeId);
        this.response.redirect = this.url('badge_mybadge');
    }

    async postReset(domainId: string) {
        await UserBadgeModel.unsetUserBadge(this.user._id);
        this.response.redirect = this.url('badge_mybadge');
    }
    
}

class BadgeManageHandler extends Handler {
    @query('page', Types.PositiveInt, true)
    async get(domainId: string, page = 1) {
        const [ddocs, dpcount] = await this.paginate(
            await BadgeModel.getMulti(),
            page,
            20
        );
        this.response.template = 'badge_manage.html';
        this.response.body = { ddocs, dpcount, page };
    }
}

class BadgeAddHandler extends Handler {
    async get(domainId: string) {
        this.response.template = 'badge_add.html';
    }

    @param('short', Types.String)
    @param('title', Types.String)
    @param('backgroundColor', Types.String)
    @param('fontColor', Types.String)
    @param('content', Types.Content)
    @param('users', Types.NumericArray, true)
    async post(domainId: string, short: string, title: string, backgroundColor: string, fontColor: string, content: string, users: [number]) {
      const badgeId = await BadgeModel.add(short, title, backgroundColor, fontColor, content, users);
      this.response.redirect = this.url('badge_detail', { id: badgeId });
    }
}

class BadgeEditHandler extends Handler {
    @param('id', Types.PositiveInt)
    async get(domainId: string, id: number) {
        const badge = await BadgeModel.get(id);
        if (!badge) throw new NotFoundError(`徽章 ${id} 不存在！`);
        this.response.template = 'badge_edit.html';
        this.response.body = { badge }
    }

    @param('id', Types.PositiveInt)
    @param('short', Types.String)
    @param('title', Types.String)
    @param('backgroundColor', Types.String)
    @param('fontColor', Types.String)
    @param('content', Types.Content)
    @param('users', Types.NumericArray, true)
    async postUpdate(domainId: string, id: number, short: string, title: string, backgroundColor: string, fontColor: string, content: string, users: [number]) {
        const users_old = (await BadgeModel.get(id)).users;
        await BadgeModel.edit(id, short, title, backgroundColor, fontColor, content, users, users_old);
        this.response.redirect = this.url('badge_detail', { id });
    }

    @param('id', Types.PositiveInt)
    async postDelete(domainId: string, id: number) {
      await BadgeModel.del(id);
      this.response.redirect = this.url('badge_manage');
    }
}

class BadgeDetailHandler extends Handler {
    @param('id', Types.PositiveInt, true)
    @query('page', Types.PositiveInt, true)
    async get(domainId: string, id: number, page = 1) {
        const badge = await BadgeModel.get(id);
        if (!badge) throw new NotFoundError(`徽章 ${id} 不存在！`);
        const userIds = badge.users?.sort((a, b) => a - b) || [];
        const [dudocs, upcount] = await this.paginate(
            UserModel.getMulti({ _id: { $in: userIds } }),
            page,
            20
        );

        const udict = await UserModel.getList(domainId, dudocs.map((x) => x._id));
        const udocs = dudocs.map((x) => udict[x._id]);

        this.response.template = 'badge_detail.html';
        this.response.body = { badge, udocs, upcount, page };
    }
}

class BadgeShowHandler extends Handler {
    @query('page', Types.PositiveInt, true)
    async get(domainId: string, page = 1) {
        const [dudocs, upcount] = await this.paginate(
            UserModel.getMulti({ badge: { $exists: true, $ne: "" } }),
            page,
            'ranking'
        );
        const udict = await UserModel.getList(domainId, dudocs.map((x) => x._id));
        const udocs = dudocs.map((x) => udict[x._id]);
        this.response.template = 'badge_show.html'; // 返回此页面
        this.response.body = { udocs, upcount, page };
    }
}

class BadgeShopPublishHandler extends Handler {
    async get() {
        const badges = await BadgeModel.coll.find({}).sort({ _id: 1 }).toArray();
        this.response.template = 'badge_shop_publish.html';
        this.response.body = {
            badges,
            page_name: 'badge_shop_publish',
        };
    }

    @param('badgeId', Types.PositiveInt)
    @param('price', Types.UnsignedInt)
    async post(domainId: string, badgeId: number, price: number) {
        const shopBridge = getShopBridge();
        if (!shopBridge) throw new ValidationError('shop', '', '尚未啟用 shop 外掛，無法發佈到商城');

        const badge = await BadgeModel.get(badgeId);
        if (!badge) throw new NotFoundError(`徽章 ${badgeId} 不存在！`);

        const objectId = `badge:${badgeId}`;
        const existed = await shopBridge.goodsModel.getByObjectId(objectId);
        if (existed) throw new ValidationError('badgeId', '', `徽章 ${badgeId} 已經在商城中`);

        const goodsId = await shopBridge.goodsModel.add(
            badge.title,
            price,
            -1,
            objectId,
            undefined,
            'badge_purchase',
            { badgeId },
            badge.content,
            '/badge/mybadge'
        );

        this.response.template = 'badge_shop_publish.html';
        this.response.body = {
            badges: await BadgeModel.coll.find({}).sort({ _id: 1 }).toArray(),
            page_name: 'badge_shop_publish',
            message: `徽章已發佈到商城，商品 ID: ${goodsId}`,
        };
    }
}

export async function apply(ctx: Context) {
    ctx.inject(['Shop'], (c) => {
        const shopBridge = getShopBridge();
        if (shopBridge) {
            shopBridge.registerGoodsPurchaseModel('badge_purchase', BadgePurchaseModel);
            shopBridge.registerShopManageEntry({
                key: 'badge_shop_publish',
                title: '發佈徽章到商城',
                href: '/badge/shop-publish',
            });
        } else {
            (ctx as any).logger?.warn?.('shop bridge not found, badge shop integration disabled');
        }
    });
    ctx.inject(['setting'], (c) => {
        c.setting.AccountSetting(
            SettingModel.Setting('setting_storage', 'badgeId', 0, 'number', 'badgeId', null, 3)
        );
    });

    ctx.on('handler/after/UserDetail#get', async (h) => {
        const uid = h.response.body.udoc?._id;
        if (!uid) {
            h.response.body.udoc.badges = [];
            return;
        }
        try {
            const cursor = await UserBadgeModel.getMulti(uid);
            const ddocs = await cursor.toArray();
            for (const ddoc of ddocs) {
                ddoc.badge = await BadgeModel.get(ddoc.badgeId);
            }
            h.response.body.badges = ddocs;
        } catch (error) {
            h.response.body.badges = [];
        }
    });
    ctx.Route('badge_show', '/badge/show', BadgeShowHandler);
    ctx.Route('badge_manage', '/badge/manage', BadgeManageHandler, PRIV.PRIV_SET_PERM);
    ctx.Route('badge_add', '/badge/add', BadgeAddHandler, PRIV.PRIV_SET_PERM);
    ctx.Route('badge_mybadge', '/badge/mybadge', UserBadgeManageHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('badge_shop_publish', '/badge/shop-publish', BadgeShopPublishHandler, PRIV.PRIV_SET_PERM);
    ctx.Route('badge_edit', '/badge/:id/edit', BadgeEditHandler, PRIV.PRIV_SET_PERM);
    ctx.Route('badge_detail', '/badge/:id', BadgeDetailHandler);
    ctx.injectUI('UserDropdown', 'badge_mybadge', { icon: 'crown', displayName: '我的徽章' });
    ctx.i18n.load('zh', {
        badge_show: '展示徽章',
        badge_manage: '管理徽章',
        badge_add: '添加徽章',
        badge_mybadge: '我的徽章',
        badge_detail: '徽章详情',
        badge_edit: '编辑徽章',
        badge_shop_publish: '發佈徽章到商城',
    });
}
