import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { emptyCoordinate, type CoordinateRow } from "../lib/field-boundary";
import { Button } from "./ui/button";

export default function CoordinateTable({
  rows,
  onChange,
}: {
  rows: CoordinateRow[];
  onChange: (rows: CoordinateRow[]) => void;
}) {
  function move(index: number, step: number) {
    const next = [...rows];
    const target = index + step;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <>
      <p>
        Введите точки по порядку обхода границы. Контур замкнётся автоматически.
      </p>
      <table className="field-coordinate-table">
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Широта</th>
            <th scope="col">Долгота</th>
            <th scope="col">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <th scope="row">{index + 1}</th>
              {(["latitude", "longitude"] as const).map((axis) => (
                <td key={axis}>
                  <input
                    inputMode="decimal"
                    aria-label={`Точка ${index + 1}, ${axis === "latitude" ? "широта" : "долгота"}`}
                    placeholder={axis === "latitude" ? "43.2389" : "76.8897"}
                    value={row[axis]}
                    onChange={(event) =>
                      onChange(
                        rows.map((entry, i) =>
                          i === index
                            ? { ...entry, [axis]: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </td>
              ))}
              <td>
                <div className="coordinate-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Переместить точку ${index + 1} вверх`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Переместить точку ${index + 1} вниз`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Удалить точку ${index + 1}`}
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        type="button"
        variant="outline"
        disabled={rows.length >= 9999}
        onClick={() => onChange([...rows, emptyCoordinate()])}
      >
        <Plus size={16} /> Добавить точку
      </Button>
    </>
  );
}
