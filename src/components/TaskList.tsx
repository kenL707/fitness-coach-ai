"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { PlanTask } from "@/lib/fitness";
import { AutoGrowText } from "./AutoGrowText";
import { cn } from "@/lib/utils";

export interface TaskActions {
  toggle: (id: string) => void;
  edit: (id: string, patch: Partial<Pick<PlanTask, "name" | "repsOrDuration">>) => void;
  remove: (id: string) => void;
  add: () => void;
  reorder: (activeId: string, overId: string) => void;
}

const editable =
  "w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 outline-none transition hover:border-slate-700 focus:border-emerald-500 focus:bg-slate-950";

function TaskRow({ task, actions }: { task: PlanTask; actions: TaskActions }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border bg-slate-900 p-1.5 sm:gap-3 sm:p-3",
        task.completed ? "border-emerald-500/40" : "border-slate-800",
        isDragging && "relative z-10 border-emerald-500 shadow-lg shadow-black/40",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder: ${task.name}`}
        className="shrink-0 cursor-grab touch-none rounded p-2 text-slate-500 sm:p-1 hover:bg-slate-800 hover:text-slate-300 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => actions.toggle(task.id)}
        aria-label={`Mark complete: ${task.name}`}
        className="h-6 w-6 shrink-0 accent-emerald-500 sm:h-5 sm:w-5"
      />

      <div className="min-w-0 flex-1 space-y-0.5">
        {/* 16px on phones: iOS zooms the page when an input smaller than that is focused. */}
        <AutoGrowText
          aria-label="Task name"
          value={task.name}
          onChange={(name) => actions.edit(task.id, { name })}
          placeholder="Task name"
          className={cn(editable, "text-base font-medium text-slate-100 sm:text-sm", task.completed && "text-slate-500 line-through")}
        />
        <AutoGrowText
          aria-label="Reps or duration"
          value={task.repsOrDuration}
          onChange={(repsOrDuration) => actions.edit(task.id, { repsOrDuration })}
          placeholder="Reps or duration"
          className={cn(editable, "text-base text-slate-400 sm:text-xs")}
        />
      </div>

      <button
        type="button"
        onClick={() => actions.remove(task.id)}
        aria-label={`Delete task: ${task.name}`}
        className="shrink-0 rounded p-2 text-slate-500 hover:bg-red-950/60 hover:text-red-300 sm:p-1.5"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

export function TaskList({ tasks, actions }: { tasks: PlanTask[]; actions: TaskActions }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) actions.reorder(String(active.id), String(over.id));
  }

  return (
    <div className="space-y-2">
      {tasks.length === 0 && <p className="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">No tasks yet.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} actions={actions} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={actions.add}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
      >
        <Plus className="h-4 w-4" /> Add task
      </button>
    </div>
  );
}
