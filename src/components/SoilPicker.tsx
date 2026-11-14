import { useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { soilOptions, type SoilChoice } from "../lib/soil";

export default function SoilPicker({
  choice,
  onChange,
}: {
  choice: SoilChoice;
  onChange: (choice: SoilChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="registration-field">
      <span id={id}>Тип почвы</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="registration-picker"
          type="button"
          aria-labelledby={`${id} ${id}-value`}
        >
          <span id={`${id}-value`}>{choice || "Выберите тип почвы"}</span>
          <ChevronsUpDown size={16} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content
          className="registration-options soil-options"
          align="start"
          sideOffset={6}
          aria-label="Тип почвы"
        >
          <Command
            label="Поиск типа почвы"
            filter={(value, search) => {
              const normalize = (text: string) =>
                text.toLocaleLowerCase("ru").replaceAll("ё", "е").trim();
              return normalize(value).includes(normalize(search)) ? 1 : 0;
            }}
          >
            <Command.Input placeholder="Поиск типа почвы…" />
            <Command.List>
              <Command.Empty>Тип почвы не найден.</Command.Empty>
              {soilOptions.map(({ label }) => (
                <Command.Item
                  key={label}
                  value={label}
                  onSelect={() => {
                    onChange(label);
                    setOpen(false);
                  }}
                >
                  <span>{label}</span>
                  {choice === label && <Check size={15} aria-hidden="true" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
