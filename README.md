<tbody>
  {bConns.map(conn => {
    // map keys → names (reuse your existing nameOf logic)
    const nameOf = (k: string) =>
      k === "focus"
        ? (focusElement?.name ?? "Focus System")
        : k.startsWith("lower-")
        ? lowerElements[parseInt(k.split("-")[1])]?.name ?? k
        : higherElements[parseInt(k.split("-")[1])]?.name ?? k;

    const from = nameOf(conn.fromKey);
    const to   = nameOf(conn.toKey);

    const k = matrixKey(from, to);
    const cell = ifmeaMatrix[k] ?? emptyCell();

    return (
      <tr key={conn.id}>
        <td className="border p-2 font-medium">{from}</td>
        <td className="border p-2 font-medium">{to}</td>
        <td className="border p-2 text-center">{conn.type}</td>

        <td className="border p-2 text-center">
          <select
            value={cell[conn.type] ?? ""}
            onChange={e =>
              setMatrixCell(
                from,
                to,
                conn.type,
                e.target.value === "" ? null : parseInt(e.target.value)
              )
            }
            className="w-16 h-7 text-xs border rounded"
          >
            <option value="">–</option>
            <option value="2">+2</option>
            <option value="1">+1</option>
            <option value="0">0</option>
            <option value="-1">−1</option>
            <option value="-2">−2</option>
          </select>
        </td>
      </tr>
    );
  })}
</tbody>
