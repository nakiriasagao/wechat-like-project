import express from "express";
import cors from "cors";
import { requireAuth } from "./middleware/auth.js";
import { guard, guardGroup } from "./middleware/guard.js";
import { notFound, errorHandler } from "./middleware/error.js";

import * as auth from "./modules/auth/controller.js";
import * as friend from "./modules/friend/controller.js";
import * as conversation from "./modules/conversation/controller.js";
import * as message from "./modules/message/controller.js";
import * as group from "./modules/group/controller.js";
import * as report from "./modules/report/controller.js";
import * as admin from "./modules/admin/controller.js";
import * as moments from "./modules/moments/controller.js";

export function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  const api = express.Router();

  // 认证
  api.post("/auth/register", auth.register);
  api.post("/auth/login", auth.login);
  api.get("/auth/me", requireAuth, auth.me);
  api.post("/users/wechat", requireAuth, auth.updateWechat);

  // 好友
  api.get("/friends/search", requireAuth, friend.search);
  api.post("/friends/request", requireAuth, friend.sendRequest);
  api.get("/friends", requireAuth, friend.listFriends);
  api.get("/friends/requests", requireAuth, friend.listRequests);
  api.post("/friends/accept", requireAuth, friend.acceptRequest);
  api.post("/friends/reject", requireAuth, friend.rejectRequest);
  api.delete("/friends/:userId", requireAuth, friend.deleteFriend);
  api.post("/friends/block", requireAuth, friend.blockUser);
  api.post("/friends/unblock", requireAuth, friend.unblockUser);
  api.get("/friends/blacklist", requireAuth, friend.listBlocked);

  // 会话
  api.get("/conversations", requireAuth, conversation.listConversations);
  api.post("/conversations/group", requireAuth, conversation.createGroup);
  api.post("/conversations/join", requireAuth, conversation.joinGroup);
  api.post("/conversations/leave", requireAuth, conversation.leaveGroup);
  api.post("/conversations/pin", requireAuth, conversation.setPin);
  api.post("/conversations/notify", requireAuth, conversation.setNotify);

  // 消息
  api.get("/conversations/:convId/messages", requireAuth, message.listMessages);
  api.post("/messages", requireAuth, message.sendMessage);
  api.post("/messages/read", requireAuth, message.markRead);
  api.post("/messages/recall", requireAuth, message.recallMessage);
  api.post("/messages/delete", requireAuth, message.deleteMessage);

  // 群治理（群内守卫）
  api.get("/group/:convId", requireAuth, group.getGroup);
  api.post("/group/:convId/invite", requireAuth, guardGroup("group:invite"), group.invite);
  api.post("/group/:convId/kick", requireAuth, guardGroup("group:kick"), group.kick);
  api.post("/group/:convId/mute", requireAuth, guardGroup("group:mute_member"), group.muteMember);
  api.post("/group/:convId/mute-all", requireAuth, guardGroup("group:mute_all"), group.muteAll);
  api.post("/group/:convId/transfer", requireAuth, guardGroup("group:transfer"), group.transferOwner);
  api.post("/group/:convId/set-admin", requireAuth, guardGroup("group:set_admin"), group.setAdmin);
  api.post("/group/:convId/notice", requireAuth, guardGroup("group:notice"), group.updateNotice);
  api.post("/group/:convId/rename", requireAuth, guardGroup("group:rename"), group.renameGroup);
  api.post("/group/:convId/disband", requireAuth, group.disband); // 群主/超管自检

  // 举报（用户可发起 -> 客服初审 -> 管理员终裁 -> 申诉）
  api.post("/reports", requireAuth, report.createReport);
  api.get("/reports/mine", requireAuth, report.myReports);
  api.get("/reports/queue", requireAuth, guard("report:review"), report.pendingQueue);
  api.post("/reports/:reportId/assign", requireAuth, guard("report:review"), report.assign);
  api.post("/reports/:reportId/reject", requireAuth, guard("report:review"), report.reviewReject);
  api.post("/reports/:reportId/escalate", requireAuth, guard("report:review"), report.escalate);
  api.post("/reports/:reportId/punish", requireAuth, guard("report:punish"), report.punish);
  api.post("/reports/:reportId/appeal", requireAuth, report.createAppeal);
  api.post("/reports/:reportId/decide", requireAuth, guard("report:punish"), report.decideAppeal);
  api.get("/reports/:reportId/events", requireAuth, report.reportEvents);

  // 朋友圈（好友可见，requireAuth 即可，无角色限制）
  api.post("/moments", requireAuth, moments.publish);
  api.get("/moments", requireAuth, moments.timeline);
  api.post("/moments/:momentId/like", requireAuth, moments.toggleLike);
  api.post("/moments/:momentId/comment", requireAuth, moments.comment);
  api.delete("/moments/:momentId", requireAuth, moments.remove);

  // 平台管理（管理员 / 超管）
  api.get("/admin/stats", requireAuth, guard("stats:view"), admin.stats);
  api.get("/admin/reports", requireAuth, guard("report:punish"), admin.allReports);
  api.get("/admin/service-accounts", requireAuth, guard("admin:manage_service"), admin.listServiceAccounts);
  api.post("/admin/service-accounts", requireAuth, guard("admin:manage_service"), admin.createServiceAccount);
  api.post("/admin/ban", requireAuth, guard("account:ban"), admin.banAccount);
  api.get("/admin/users", requireAuth, guard("account:ban"), admin.listUsers);

  app.use("/api", api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
