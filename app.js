/**
 * AIツール比較メモ (app.js)
 * - 初期JSONデータの表示・追加・編集・削除
 * - 名前・メモの部分一致検索
 * - 月額料金の昇順・降順ソート
 * - localStorageへの自動保存と初期状態へのリセット
 * - 日本語対応（UTF-8 BOM付き）CSVダウンロード
 * - 空欄・0円許容・重複チェック等の厳密な入力検証
 * - XSS対策（createElement + textContent による安全なDOM構築）
 */

(function () {
  "use strict";

  const STORAGE_KEY = "ai_tool_comparison_memo_v1";

  // 課題指定の初期データ
  const INITIAL_DATA = [
    { name: "Alpha", monthly: 3000, memo: "文章" },
    { name: "Beta", monthly: 0, memo: "調査" },
    { name: "Gamma", monthly: 5000, memo: "画像" }
  ];

  // アプリケーション状態
  let tools = [];
  let editingId = null;
  let toastTimer = null;

  // DOM要素の参照
  const toolForm = document.getElementById("toolForm");
  const formHeading = document.getElementById("formHeading");
  const editModeBadge = document.getElementById("editModeBadge");
  const editingIdInput = document.getElementById("editingId");
  const toolNameInput = document.getElementById("toolName");
  const toolMonthlyInput = document.getElementById("toolMonthly");
  const toolMemoInput = document.getElementById("toolMemo");
  const submitBtn = document.getElementById("submitBtn");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const errorAlert = document.getElementById("errorAlert");
  const errorList = document.getElementById("errorList");

  const searchInput = document.getElementById("searchInput");
  const sortSelect = document.getElementById("sortSelect");
  const tableSortBtn = document.getElementById("tableSortBtn");
  const sortIcon = document.getElementById("sortIcon");
  const toolTableBody = document.getElementById("toolTableBody");
  const emptyState = document.getElementById("emptyState");
  const emptyStateText = document.getElementById("emptyStateText");
  const countDisplay = document.getElementById("countDisplay");
  const totalMonthlyDisplay = document.getElementById("totalMonthlyDisplay");
  const statusMessage = document.getElementById("statusMessage");

  const downloadCsvBtn = document.getElementById("downloadCsvBtn");
  const resetDataBtn = document.getElementById("resetDataBtn");

  /**
   * 一意な内部IDを生成する
   */
  function generateId() {
    return "tool_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  }

  /**
   * 初期データのディープコピー（内部ID付き）を作成する
   */
  function createInitialTools() {
    return INITIAL_DATA.map((item) => ({
      id: generateId(),
      name: String(item.name),
      monthly: Number(item.monthly),
      memo: String(item.memo)
    }));
  }

  /**
   * localStorageからデータを読み込む（破損時は初期データにフォールバック）
   */
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        tools = createInitialTools();
        saveToStorage();
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("保存データの形式が不正です");
      }
      tools = parsed
        .filter(
          (item) =>
            item &&
            typeof item.name === "string" &&
            item.name.trim() !== "" &&
            typeof item.monthly === "number" &&
            Number.isFinite(item.monthly) &&
            item.monthly >= 0 &&
            typeof item.memo === "string"
        )
        .map((item) => ({
          id: generateId(),
          name: item.name.trim(),
          monthly: Math.floor(item.monthly),
          memo: item.memo.trim()
        }));
    } catch (e) {
      console.warn("localStorageの読み込みに失敗したため初期データを使用します:", e);
      tools = createInitialTools();
      saveToStorage();
    }
  }

  /**
   * localStorageへデータを保存する（初期データと同じJSON構造で保存）
   */
  function saveToStorage() {
    try {
      const serializable = tools.map(({ name, monthly, memo }) => ({
        name,
        monthly,
        memo
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (e) {
      console.error("localStorageへの保存に失敗しました:", e);
    }
  }

  /**
   * ステータスメッセージ（トースト）を表示する
   */
  function showStatus(message) {
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    statusMessage.textContent = message;
    statusMessage.hidden = false;
    toastTimer = setTimeout(() => {
      statusMessage.hidden = true;
    }, 3000);
  }

  /**
   * エラー表示をクリアまたは更新する
   */
  function renderErrors(errors) {
    while (errorList.firstChild) {
      errorList.removeChild(errorList.firstChild);
    }
    if (!errors || errors.length === 0) {
      errorAlert.hidden = true;
      return;
    }
    errors.forEach((msg) => {
      const li = document.createElement("li");
      li.textContent = msg;
      errorList.appendChild(li);
    });
    errorAlert.hidden = false;
  }

  /**
   * 入力値の検証（空欄・0円・重複・数値範囲のチェック）
   */
  function validateInput(rawName, rawMonthly, rawMemo, currentEditingId) {
    const errors = [];
    const trimmedName = rawName.trim();
    const trimmedMonthly = rawMonthly.trim();
    const trimmedMemo = rawMemo.trim();

    // 1. ツール名の空欄＆重複チェック
    if (trimmedName === "") {
      errors.push("ツール名を入力してください（空白のみは登録できません）。");
    } else {
      const normalizedNewName = trimmedName.toLowerCase();
      const isDuplicate = tools.some(
        (item) =>
          item.id !== currentEditingId &&
          item.name.trim().toLowerCase() === normalizedNewName
      );
      if (isDuplicate) {
        errors.push(`ツール名「${trimmedName}」は既に登録されています。別の名前を入力してください。`);
      }
    }

    // 2. 月額料金の空欄・0円・整数チェック
    // Number("") は 0 になるため、先に空文字列かどうかを厳密に判定する
    if (trimmedMonthly === "") {
      errors.push("月額料金を入力してください（無料の場合は 0 を入力してください）。");
    } else {
      const parsedNumber = Number(trimmedMonthly);
      if (
        !/^\d+$/.test(trimmedMonthly) ||
        !Number.isSafeInteger(parsedNumber) ||
        parsedNumber < 0
      ) {
        errors.push("月額料金は 0 以上の整数（半角数字）で入力してください。");
      } else if (parsedNumber > 10000000) {
        errors.push("月額料金は 10,000,000 円以下で入力してください。");
      }
    }

    // 3. 用途・メモの空欄チェック
    if (trimmedMemo === "") {
      errors.push("用途・メモを入力してください（空白のみは登録できません）。");
    }

    return {
      isValid: errors.length === 0,
      errors,
      cleanedData: {
        name: trimmedName,
        monthly: trimmedMonthly === "" ? null : Number(trimmedMonthly),
        memo: trimmedMemo
      }
    };
  }

  /**
   * 検索・ソート条件を適用した一覧配列を返す
   */
  function getFilteredAndSortedTools() {
    const query = searchInput.value.trim().toLowerCase();
    const sortMode = sortSelect.value;

    // 名前・メモの部分一致検索
    let result = tools.filter((item) => {
      if (query === "") return true;
      const nameMatch = item.name.toLowerCase().includes(query);
      const memoMatch = item.memo.toLowerCase().includes(query);
      return nameMatch || memoMatch;
    });

    // 料金の昇順・降順ソート
    if (sortMode === "asc") {
      result = [...result].sort((a, b) => a.monthly - b.monthly);
    } else if (sortMode === "desc") {
      result = [...result].sort((a, b) => b.monthly - a.monthly);
    }

    return result;
  }

  /**
   * ソートアイコンの表示を更新する
   */
  function updateSortIcon() {
    const mode = sortSelect.value;
    if (mode === "asc") {
      sortIcon.textContent = "↑";
    } else if (mode === "desc") {
      sortIcon.textContent = "↓";
    } else {
      sortIcon.textContent = "↕";
    }
  }

  /**
   * 金額を通貨形式（¥3,000）にフォーマットする
   */
  function formatCurrency(amount) {
    return "¥" + amount.toLocaleString("ja-JP");
  }

  /**
   * テーブル一覧を描画する（XSS対策のため createElement と textContent のみ使用）
   */
  function renderList() {
    updateSortIcon();

    const filtered = getFilteredAndSortedTools();

    // 既存の行をクリア
    while (toolTableBody.firstChild) {
      toolTableBody.removeChild(toolTableBody.firstChild);
    }

    // サマリー（件数・合計金額）の更新
    countDisplay.textContent = String(filtered.length);
    const totalMonthly = filtered.reduce((sum, item) => sum + item.monthly, 0);
    totalMonthlyDisplay.textContent = formatCurrency(totalMonthly);

    // 0件時の表示
    if (filtered.length === 0) {
      emptyState.hidden = false;
      if (tools.length === 0) {
        emptyStateText.textContent = "登録されているAIツールがありません。上のフォームから追加してください。";
      } else {
        emptyStateText.textContent = "検索条件に一致するツールが見つかりません。";
      }
      return;
    }

    emptyState.hidden = true;

    // 各行を安全に生成
    filtered.forEach((item) => {
      const tr = document.createElement("tr");
      if (item.id === editingId) {
        tr.classList.add("is-editing");
      }

      // ツール名セル
      const tdName = document.createElement("td");
      tdName.className = "col-name";
      tdName.setAttribute("data-label", "ツール名");
      tdName.textContent = item.name;
      tr.appendChild(tdName);

      // 月額料金セル
      const tdMonthly = document.createElement("td");
      tdMonthly.className = "col-monthly";
      tdMonthly.setAttribute("data-label", "月額料金");

      const priceWrap = document.createElement("span");
      const priceText = document.createElement("span");
      priceText.className = "price-badge";
      priceText.textContent = formatCurrency(item.monthly);
      priceWrap.appendChild(priceText);

      if (item.monthly === 0) {
        const freeBadge = document.createElement("span");
        freeBadge.className = "price-free";
        freeBadge.textContent = "無料";
        priceWrap.appendChild(freeBadge);
      }

      tdMonthly.appendChild(priceWrap);
      tr.appendChild(tdMonthly);

      // 用途・メモセル
      const tdMemo = document.createElement("td");
      tdMemo.className = "col-memo";
      tdMemo.setAttribute("data-label", "用途・メモ");
      tdMemo.textContent = item.memo;
      tr.appendChild(tdMemo);

      // 操作ボタンセル
      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";
      tdActions.setAttribute("data-label", "操作");

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "row-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-sm btn-edit";
      editBtn.textContent = "編集";
      editBtn.setAttribute("aria-label", `${item.name} を編集`);
      editBtn.addEventListener("click", () => startEdit(item.id));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-sm btn-delete";
      deleteBtn.textContent = "削除";
      deleteBtn.setAttribute("aria-label", `${item.name} を削除`);
      deleteBtn.addEventListener("click", () => handleDelete(item.id));

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);
      tdActions.appendChild(actionsDiv);
      tr.appendChild(tdActions);

      toolTableBody.appendChild(tr);
    });
  }

  /**
   * 編集モードを開始する
   */
  function startEdit(id) {
    const target = tools.find((item) => item.id === id);
    if (!target) return;

    editingId = target.id;
    editingIdInput.value = target.id;
    toolNameInput.value = target.name;
    toolMonthlyInput.value = String(target.monthly);
    toolMemoInput.value = target.memo;

    formHeading.textContent = `ツールを編集（${target.name}）`;
    editModeBadge.hidden = false;
    submitBtn.textContent = "✓ 更新する";
    cancelEditBtn.hidden = false;

    renderErrors([]);
    renderList();

    toolForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
    toolNameInput.focus();
  }

  /**
   * 編集モードを解除し、フォームを初期化する
   */
  function resetFormState() {
    editingId = null;
    editingIdInput.value = "";
    toolForm.reset();

    formHeading.textContent = "ツールを追加";
    editModeBadge.hidden = true;
    submitBtn.textContent = "＋ 追加する";
    cancelEditBtn.hidden = true;

    renderErrors([]);
    renderList();
  }

  /**
   * フォーム送信（新規追加または編集更新）
   */
  function handleFormSubmit(event) {
    event.preventDefault();

    const validation = validateInput(
      toolNameInput.value,
      toolMonthlyInput.value,
      toolMemoInput.value,
      editingId
    );

    if (!validation.isValid) {
      renderErrors(validation.errors);
      return;
    }

    const { name, monthly, memo } = validation.cleanedData;

    if (editingId) {
      // 既存データの更新
      const index = tools.findIndex((item) => item.id === editingId);
      if (index !== -1) {
        tools[index] = {
          ...tools[index],
          name,
          monthly,
          memo
        };
        saveToStorage();
        resetFormState();
        showStatus(`「${name}」の内容を更新しました。`);
      }
    } else {
      // 新規追加
      tools.push({
        id: generateId(),
        name,
        monthly,
        memo
      });
      saveToStorage();
      resetFormState();
      showStatus(`「${name}」を追加しました。`);
    }
  }

  /**
   * ツールの削除
   */
  function handleDelete(id) {
    const target = tools.find((item) => item.id === id);
    if (!target) return;

    const confirmed = window.confirm(`「${target.name}」を削除してもよろしいですか？`);
    if (!confirmed) return;

    tools = tools.filter((item) => item.id !== id);
    saveToStorage();

    if (editingId === id) {
      resetFormState();
    } else {
      renderList();
    }
    showStatus(`「${target.name}」を削除しました。`);
  }

  /**
   * 初期状態へリセット
   */
  function handleResetData() {
    const confirmed = window.confirm(
      "登録データを初期状態（Alpha / Beta / Gamma の3件）へリセットしますか？\n現在の変更内容は失われます。"
    );
    if (!confirmed) return;

    tools = createInitialTools();
    saveToStorage();

    searchInput.value = "";
    sortSelect.value = "default";
    resetFormState();
    showStatus("データを初期状態へリセットしました。");
  }

  /**
   * CSVの1セル分を安全にエスケープする（RFC 4180準拠 + CSVインジェクション対策）
   */
  function escapeCsvCell(value) {
    let str = String(value ?? "");
    // 先頭が =, +, -, @ で始まる場合は表計算ソフトでの数式実行を防ぐためシングルクォートを付与
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str;
    }
    // ダブルクォートを2つにエスケープし、全体をダブルクォートで囲む
    return `"${str.replace(/"/g, '""')}"`;
  }

  /**
   * CSVダウンロード（UTF-8 BOM付きで日本語の文字化けを防止）
   */
  function handleDownloadCsv() {
    const targetList = getFilteredAndSortedTools();
    if (targetList.length === 0) {
      window.alert("ダウンロードできるデータがありません。");
      return;
    }

    const headers = ["ツール名", "月額料金(円)", "用途・メモ"];
    const rows = targetList.map((item) => [
      escapeCsvCell(item.name),
      escapeCsvCell(item.monthly),
      escapeCsvCell(item.memo)
    ]);

    const csvLines = [headers.map(escapeCsvCell).join(","), ...rows.map((r) => r.join(","))];
    // Excelでも日本語が文字化けしないよう UTF-8 BOM (\uFEFF) を付与し CRLF で結合
    const csvContent = "\uFEFF" + csvLines.join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");

    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-tools-memo_${yyyy}${mm}${dd}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showStatus("CSVファイルをダウンロードしました。");
  }

  /**
   * テーブルヘッダーの料金ソートボタンクリック時に昇順・降順を切り替える
   */
  function handleTableSortToggle() {
    if (sortSelect.value === "asc") {
      sortSelect.value = "desc";
    } else if (sortSelect.value === "desc") {
      sortSelect.value = "default";
    } else {
      sortSelect.value = "asc";
    }
    renderList();
  }

  /**
   * イベントリスナーの登録と初期化
   */
  function init() {
    loadFromStorage();
    renderList();

    toolForm.addEventListener("submit", handleFormSubmit);
    cancelEditBtn.addEventListener("click", resetFormState);
    searchInput.addEventListener("input", renderList);
    sortSelect.addEventListener("change", renderList);
    tableSortBtn.addEventListener("click", handleTableSortToggle);
    downloadCsvBtn.addEventListener("click", handleDownloadCsv);
    resetDataBtn.addEventListener("click", handleResetData);
  }

  init();
})();
