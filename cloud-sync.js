
/* 雀蜂杯 Firebase 同期処理 */
(() => {
  "use strict";

  const DATA_KEY = "jakuhouCupDataV8";
  const ADMIN_UID = window.JAMPO_FIREBASE_ADMIN_UID;
  const CONFIG = window.JAMPO_FIREBASE_CONFIG;

  let auth = null;
  let db = null;
  let loginOverlay = null;
  let initialized = false;
  let initializing = null;
  let loadingRemote = false;
  let saving = false;
  let authReadyPromise = null;
  let saveQueue = Promise.resolve();

  window.JAMPO_CLOUD_CONFIGURED = !!(
    CONFIG &&
    CONFIG.projectId &&
    ADMIN_UID &&
    ADMIN_UID !== "ここに管理者UIDを貼り付け"
  );

  function initFirebase() {
    if (!window.JAMPO_CLOUD_CONFIGURED) {
      throw new Error("firebase-config.js の設定を確認してください。");
    }

    if (!window.firebase) {
      throw new Error("Firebase SDKが読み込まれていません。");
    }

    if (auth && db) return;

    const app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(CONFIG);

    auth = app.auth();
    db = app.firestore();

    // ログイン状態の復元を待つ
    authReadyPromise = new Promise((resolve, reject) => {
      let unsubscribe = null;

      unsubscribe = auth.onAuthStateChanged(
        user => {
          if (unsubscribe) unsubscribe();
          resolve(user);
        },
        error => {
          if (unsubscribe) unsubscribe();
          reject(error);
        }
      );
    });
  }

  async function waitForAuth() {
    initFirebase();

    if (auth.currentUser) return auth.currentUser;

    if (authReadyPromise) {
      await authReadyPromise;
    }

    return auth.currentUser;
  }

  function isAdminUser() {
    return !!(
      auth &&
      auth.currentUser &&
      auth.currentUser.uid === ADMIN_UID
    );
  }

  async function getSession() {
    await waitForAuth();

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

    const value = snapshot.data().data;

    // 不正な形式のデータで既存データを上書きしない
    if (
      value === null ||
      typeof value !== "object"
    ) {
      console.warn(
        "[雀蜂杯] Firebaseのデータ形式が正しくありません。"
      );
      return null;
    }

    return value;
  }

  async function saveNow(data) {
    await waitForAuth();

    if (!isAdminUser()) {
      throw new Error("管理者としてログインしてください。");
    }

    const value = data === undefined
      ? JSON.parse(localStorage.getItem(DATA_KEY) || "null")
      : data;

    if (
      value === null ||
      value === undefined ||
      typeof value !== "object"
    ) {
      throw new Error("保存するサイトデータがありません。");
    }

    const json = JSON.stringify(value);
    const size = new TextEncoder().encode(json).length;

    // Firestoreのドキュメント上限に余裕を持たせる
    if (size > 900 * 1024) {
      throw new Error(
        "サイトデータが大きすぎます。" +
        "画像データをFirebase Storageへ分離する必要があります。"
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
      console.error("[雀蜂杯] Firebase保存エラー:", error);
      throw error;
    } finally {
      saving = false;
    }
  }

  // 保存が連続しても、後から行った変更が古いデータで
  // 上書きされにくいように順番に処理する
  function save(data) {
    const task = saveQueue.then(() => saveNow(data));

    // 1回の失敗で以後の保存が止まらないようにする
    saveQueue = task.catch(() => {});

    return task;
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

    // 管理画面のログアウト時だけ再読み込みする
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
        <input id="jampoEmail" type="email" required
          autocomplete="username"
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

    document
      .getElementById("jampoFirebaseLoginForm")
      .addEventListener("submit", async event => {
        event.preventDefault();

        const errorBox =
          document.getElementById("jampoLoginError");
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

            try {
              localStorage.setItem(
                DATA_KEY,
                JSON.stringify(remote)
              );
            } finally {
              loadingRemote = false;
            }
          } else {
            const local = JSON.parse(
              localStorage.getItem(DATA_KEY) || "null"
            );

            if (local !== null) {
              await save(local);
            }
          }

          // ログイン後は管理画面を再読み込み
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
    if (initializing) return initializing;

    initializing = (async () => {
      try {
        await waitForAuth();

        const isAdminPage =
          /(^|\/)admin\.html$/i.test(location.pathname);

        if (isAdminPage && !isAdminUser()) {
          showLogin();
        }

        const remote = await readRemote();

        if (remote !== null) {
          const local = localStorage.getItem(DATA_KEY);
          const remoteJSON = JSON.stringify(remote);

          if (local !== remoteJSON) {
            loadingRemote = true;

            try {
              localStorage.setItem(DATA_KEY, remoteJSON);
            } finally {
              loadingRemote = false;
            }

            // ページ全体を再読み込みせず、更新イベントを通知
            window.dispatchEvent(
              new Event("jampo-data-updated")
            );
          }
        }

        if (isAdminPage && isAdminUser() && loginOverlay) {
          loginOverlay.remove();
          loginOverlay = null;
        }

        initialized = true;
      } catch (error) {
        console.error("[雀蜂杯] Firebase同期エラー:", error);
      } finally {
        initializing = null;
      }
    })();

    return initializing;
  }

  // localStorageへの既存の保存処理を維持し、
  // 管理者による変更をFirebaseへ自動保存する
  const originalSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);

    if (
      this !== window.localStorage ||
      key !== DATA_KEY ||
      loadingRemote ||
      !isAdminUser()
    ) {
      return;
    }

    try {
      const data = JSON.parse(value);

      save(data).catch(error => {
        console.error("[雀蜂杯] 自動保存エラー:", error);

        // 保存失敗時に管理者へ通知
        if (!saving) {
          alert(
            "Firebaseへの自動保存に失敗しました。\n" +
            (error.message || "詳細はコンソールを確認してください。")
          );
        }
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {
      once: true
    });
  } else {
    start();
  }
})();
