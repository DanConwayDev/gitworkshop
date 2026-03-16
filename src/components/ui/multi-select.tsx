import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
  /** Icon rendered before the placeholder/badge summary */
  icon?: React.ReactNode;
  /** Max number of selected labels shown inline before collapsing to a count */
  maxShown?: number;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select...",
  className,
  icon,
  maxShown = 2,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const renderTriggerLabel = () => {
    if (selected.length === 0) {
      return (
        <span className="text-muted-foreground text-sm">{placeholder}</span>
      );
    }
    if (selected.length <= maxShown) {
      return (
        <div className="flex gap-1 flex-wrap">
          {selected.map((v) => {
            const opt = options.find((o) => o.value === v);
            return (
              <Badge
                key={v}
                variant="secondary"
                className="text-xs px-1.5 py-0 h-5 font-normal"
              >
                {opt?.label ?? v}
              </Badge>
            );
          })}
        </div>
      );
    }
    return <span className="text-sm">{selected.length} selected</span>;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 justify-between gap-1.5 px-3 font-normal text-sm",
            className,
          )}
        >
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            {icon && (
              <span className="shrink-0 text-muted-foreground">{icon}</span>
            )}
            <span className="min-w-0 flex-1 text-left">
              {renderTriggerLabel()}
            </span>
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                className="rounded-sm p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={clear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    clear(e as unknown as React.MouseEvent);
                }}
                aria-label="Clear selection"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => toggle(option.value)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-sm border border-primary shrink-0",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <span>{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
