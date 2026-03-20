# badge

以 https://github.com/cqzym1985/my-hydro-plugins 為基礎，並擴充為可與 `shop` 外掛整合的徽章系統。

## 功能

- 徽章新增、編輯、刪除。
- 使用者徽章管理（啟用/重設顯示徽章）。
- 徽章展示頁。
- 與商店整合：
	- 可將徽章發佈到商店。
	- 兌換時透過 `badge_purchase` 自動發放徽章。
	- 若使用者已擁有該徽章，會拒絕購買並回傳清楚訊息。

## 路由

- `badge_show` `/badge/show`
- `badge_manage` `/badge/manage`
- `badge_add` `/badge/add`
- `badge_mybadge` `/badge/mybadge`
- `badge_detail` `/badge/:id`
- `badge_edit` `/badge/:id/edit`
- `badge_shop_publish` `/badge/shop-publish`

## Shop 整合設計

### 1) Runtime Bridge（非靜態相對匯入）

本外掛不直接使用 `../shop` 類型的靜態相對路徑匯入，而是透過 runtime bridge：

- 讀取 `(global.Hydro as any).shopBridge`
- 若 shop 可用：註冊購買模型與管理入口
- 若 shop 不可用：降級為只保留 badge 本體功能

### 2) 發佈徽章到商店

在 `badge_shop_publish` 中，會建立商店商品：

- `name` = `badge.title`
- `objectId` = `badge:{badgeId}`
- `purchaseModelId` = `badge_purchase`
- `data.badgeId` = 徽章 ID
- `description` = `badge.content`

`shop` 端會以 Markdown 渲染 `description`，因此徽章內容可直接在商城顯示。

### 3) 購買處理器 `badge_purchase`

購買流程由 `BadgePurchaseModel.purchase(...)` 處理：

- 徽章不存在：回傳失敗訊息。
- 使用者已擁有該徽章：回傳失敗訊息（例如：你已擁有徽章「...」）。
- 驗證通過：新增使用者徽章並回傳成功。

## 權限

- `badge_manage`、`badge_add`、`badge_edit`、`badge_shop_publish` 需要管理權限（`PRIV.PRIV_SET_PERM`）。
- `badge_mybadge` 需要 `PRIV.PRIV_USER_PROFILE`。

## 注意事項

- 若要使用商店發佈與兌換，請先啟用 `shop` 外掛。
- 若 `shop` 未啟用，本外掛仍可正常使用徽章基本功能。
- 建議在生產環境固定外掛載入順序，確保 `shop` 先於 `badge` 初始化，以便立即完成 bridge 註冊。