
/* 雀蜂杯 Firebase 同期処理 */
(() => {
  "use strict";

  const DATA_KEY = "jakuhouCupDataV8";
  const ADMIN_UID = window.JAMPO_FIREBASE_ADMIN_UID;
  const CONFIG = window.JAMPO_FIREBASE_CONFIG;

  let auth;
  let db;
  let loadingRemote = false;
  let saving = false;
  let loginOverlay;
  let initialized = false;

  window.JAMPO_CLOUD_CONFIGURED = !!(
    CONFIG && CONFIG.projectId && ADMIN_UID &&
    ADMIN_UID !== "ここに管理者UIDを貼り付け"
  );

  function initFirebase() {
    if (!window.JAMPO_CLOUD_CONFIGURED) {
      throw new Error("firebase-config.js の設定を確認してください。");
    }

    if (!window.firebase) {
      throw new Error("Firebase SDKが読み込まれていません。");
    }

    if (!auth) {
      const app = window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(CONFIG);

      auth = app.auth();
      db = app.firestore();
    }
  }

  function isAdminUser() {
    return !!(
      auth &&
      auth.currentUser &&
      auth.currentUser.uid === ADMIN_UID
    );
  }

  async function getSession() {
    initFirebase();
    const user = auth.currentUser;

    if (!user) return null;

    return {
      user: {
        id: user.uid,
        uid: user.uid,
        email: user.email
      }
    };
  }

  async function readRemote() {
    initFirebase();

    const snapshot = await db
      .collection("siteData")
      .doc("main")
      .get();

    if (!snapshot.exists) return null;

    return snapshot.data().data ?? null;
  }

  async function save(data) {
    initFirebase();

    if (!isAdminUser()) {
      throw new Error("管理者としてログインしてください。");
    }

    const value = data === undefined
      ? JSON.parse(localStorage.getItem(DATA_KEY) || "null")
      : data;

    if (value === null || value === undefined) {
      throw new Error("保存するサイトデータがありません。");
    }

    const json = JSON.stringify(value);
    const size = new TextEncoder().encode(json).length;

    // Firestoreの1ドキュメント上限に余裕を持たせる
    if (size > 900 * 1024) {
      throw new Error(
        "サイトデータが大きすぎます。画像データをFirebase Storageへ分離する必要があります。"
      );
    }

    saving = true;

    try {
      await db.collection("siteData").doc("main").set({
        data: value,
        updatedAt: new Date().toISOString()
      });

      console.log("[雀蜂杯] Firebaseへ保存しました。");
      return true;
    } catch (error) {
      console.error("[雀蜂杯] 保存エラー:", error);
      alert("Firebaseへの保存に失敗しました。\n" + error.message);
      throw error;
    } finally {
      saving = false;
    }
  }

  async function login(email, password) {
    initFirebase();

    const result = await auth.signInWithEmailAndPassword(
      email,
      password
    );

    if (result.user.uid !== ADMIN_UID) {
      await auth.signOut();
      throw new Error(
        "このアカウントは雀蜂杯サイトの管理者ではありません。"
      );
    }

    return getSession();
  }

  async function logout() {
    initFirebase();
    await auth.signOut();
    location.reload();
  }

  function showLogin() {
    if (loginOverlay || !document.body) return;

    loginOverlay = document.createElement("div");
    loginOverlay.id = "jampoFirebaseLogin";

    Object.assign(loginOverlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "999999",
      background: "#111827",
      color: "#ffffff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      fontFamily: "sans-serif"
    });

    loginOverlay.innerHTML = `
      <form id="jampoFirebaseLoginForm"
        style="background:#1f2937;padding:28px;border-radius:12px;
        width:100%;max-width:380px;box-sizing:border-box">
        <h2 style="margin-top:0">雀蜂杯 管理者ログイン</h2>
        <p style="font-size:14px;color:#d1d5db">
          Firebaseに登録した管理者アカウントでログインしてください。
        </p>
        <label for="jampoEmail">メールアドレス</label>
        <input id="jampoEmail" type="email" required autocomplete="username"
          style="display:block;box-sizing:border-box;width:100%;
          padding:12px;margin:8px 0 16px">
        <label for="jampoPassword">パスワード</label>
        <input id="jampoPassword" type="password" required
          autocomplete="current-password"
          style="display:block;box-sizing:border-box;width:100%;
          padding:12px;margin:8px 0 16px">
        <button type="submit"
          style="width:100%;padding:12px;background:#f59e0b;
          border:0;border-radius:6px;font-weight:bold;cursor:pointer">
          ログイン
        </button>
        <p id="jampoLoginError" role="alert"
          style="color:#fca5a5;font-size:14px"></p>
      </form>
    `;

    document.body.appendChild(loginOverlay);

    document.getElementById("jampoFirebaseLoginForm")
      .addEventListener("submit", async event => {
        event.preventDefault();

        const errorBox = document.getElementById("jampoLoginError");
        const button = event.currentTarget.querySelector("button");
        button.disabled = true;
        errorBox.textContent = "ログイン中…";

        try {
          await login(
            document.getElementById("jampoEmail").value.trim(),
            document.getElementById("jampoPassword").value
          );

          const remote = await readRemote();

          if (remote !== null) {
            loadingRemote = true;
            localStorage.setItem(DATA_KEY, JSON.stringify(remote));
            loadingRemote = false;
          } else {
            const local = JSON.parse(
              localStorage.getItem(DATA_KEY) || "null"
            );
            if (local !== null) await save(local);
          }

          location.reload();
        } catch (error) {
          loadingRemote = false;
          errorBox.textContent =
            error.message || "ログインに失敗しました。";
          button.disabled = false;
        }
      });
  }

  async function start() {
    if (initialized) return;
    initialized = true;

    try {
      initFirebase();

      const isAdminPage =
        /(^|\/)admin\.html$/i.test(location.pathname);

      if (isAdminPage && !isAdminUser()) {
        showLogin();
      }

      // 公開ページはログイン不要でFirestoreのデータを読み込む
      const remote = await readRemote();

      if (remote !== null) {
        const local = localStorage.getItem(DATA_KEY);
        const remoteJSON = JSON.stringify(remote);

        if (local !== remoteJSON) {
          loadingRemote = true;
          localStorage.setItem(DATA_KEY, remoteJSON);
          loadingRemote = false;

          // 表示側に最新データを読み直させる
          if (!isAdminPage) location.reload();
        }
      }

      // 管理者ページのログイン後は、ログイン処理が同期を行う
      if (isAdminPage && isAdminUser() && loginOverlay) {
        loginOverlay.remove();
        loginOverlay = null;
      }
    } catch (error) {
      loadingRemote = false;
      console.error("[雀蜂杯] Firebase初期化エラー:", error);
    }
  }

  // 既存の管理画面がlocalStorageへ保存する仕組みを維持する
  const originalSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);

    if (
      this !== window.localStorage ||
      key !== DATA_KEY ||
      loadingRemote ||
      saving ||
      !isAdminUser()
    ) return;

    try {
      const data = JSON.parse(value);
      save(data).catch(error => {
        console.error("[雀蜂杯] 自動保存エラー:", error);
      });
    } catch (error) {
      console.error("[雀蜂杯] データ処理エラー:", error);
    }
  };

  window.JAMPO_CLOUD = {
    login,
    logout,
    getSession,
    isAdminUser,
    readRemote,
    save,
    initializeDataIfEmpty: start
  };

  document.addEventListener("DOMContentLoaded", start);
})();
