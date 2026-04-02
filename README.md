const isConnected = (from: string, to: string, type: ConnType) => {
  const nameOf = (k: string) =>
    k === "focus"
      ? (focusElement?.name ?? "Focus System")
      : k.startsWith("lower-")
      ? lowerElements[parseInt(k.split("-")[1])]?.name ?? k
      : higherElements[parseInt(k.split("-")[1])]?.name ?? k;

  return bConns.some(conn => {
    const fromName = nameOf(conn.fromKey);
    const toName   = nameOf(conn.toKey);

    return (
      fromName === from &&
      toName === to &&
      conn.type === type
    );
  });
};





(["P","E","I","M"] as ConnType[]).map(t => {
  const connected = isConnected(rowEl, colEl, t);

  return (
    <select
      key={t}
      value={cell[t] ?? ""}
      disabled={!connected}
      onChange={e =>
        setMatrixCell(
          rowEl,
          colEl,
          t,
          e.target.value === "" ? null : parseInt(e.target.value)
        )
      }
      className={`w-14 h-7 text-xs border rounded
        ${connected ? "bg-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"}
      `}
    >
      <option value="">–</option>
      <option value="2">+2</option>
      <option value="1">+1</option>
      <option value="0">0</option>
      <option value="-1">−1</option>
      <option value="-2">−2</option>
    </select>
  );
})
