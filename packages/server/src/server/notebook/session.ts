import type { SessionOutboundMessage } from "../messages.js";
import type {
  AgentNotebookAppendRequest,
  AgentNotebookGetRequest,
} from "@getpaseo/protocol/notebook/rpc-schemas";
import type { DerivedNotebookSources } from "./derived-sources.js";
import {
  WorkNotebookInvalidTargetError,
  WorkNotebookRevisionConflictError,
  type WorkNotebookStore,
} from "./store.js";

export interface WorkNotebookSessionHost {
  emit(message: SessionOutboundMessage): void;
  getAgentState(agentId: string): Promise<"active" | "archived" | "missing">;
  getDerivedSources(agentId: string): Promise<DerivedNotebookSources | null>;
}

export class WorkNotebookSession {
  constructor(
    private readonly host: WorkNotebookSessionHost,
    private readonly store: WorkNotebookStore,
  ) {}

  async handleGetRequest(request: AgentNotebookGetRequest): Promise<void> {
    const agentState = await this.host.getAgentState(request.agentId);
    if (agentState === "missing") {
      this.host.emit({
        type: "agent.notebook.get.response",
        payload: {
          requestId: request.requestId,
          result: {
            status: "error",
            code: "agent_not_found",
            message: "Agent not found",
          },
        },
      });
      return;
    }
    if (agentState === "active") {
      const sources = await this.host.getDerivedSources(request.agentId);
      if (sources) {
        await this.store.reconcileDerivedSources({ agentId: request.agentId, sources });
      }
    }

    const page = await this.store.getSessionNotebookPage({
      agentId: request.agentId,
      afterSequence: request.afterSequence,
      limit: request.limit,
    });
    this.host.emit({
      type: "agent.notebook.get.response",
      payload: {
        requestId: request.requestId,
        result: {
          status: "found",
          ...page,
          writable: agentState === "active",
          readOnlyReason: agentState === "archived" ? "agent_archived" : null,
        },
      },
    });
  }

  async handleAppendRequest(request: AgentNotebookAppendRequest): Promise<void> {
    const agentState = await this.host.getAgentState(request.agentId);
    if (agentState === "missing") {
      this.emitAppendError(request.requestId, "agent_not_found", "Agent not found");
      return;
    }
    if (agentState === "archived") {
      this.emitAppendError(request.requestId, "agent_archived", "Archived notebooks are read-only");
      return;
    }

    try {
      const appended = await this.store.append({
        agentId: request.agentId,
        expectedRevision: request.expectedRevision,
        author: { kind: "user" },
        entry: request.entry,
      });
      this.host.emit({
        type: "agent.notebook.append.response",
        payload: {
          requestId: request.requestId,
          result: {
            status: "applied",
            ...appended,
          },
        },
      });
    } catch (error) {
      if (error instanceof WorkNotebookRevisionConflictError) {
        this.host.emit({
          type: "agent.notebook.append.response",
          payload: {
            requestId: request.requestId,
            result: {
              status: "conflict",
              currentRevision: error.currentRevision,
            },
          },
        });
        return;
      }
      if (error instanceof WorkNotebookInvalidTargetError) {
        this.emitAppendError(request.requestId, "invalid_target", error.message);
        return;
      }
      throw error;
    }
  }

  private emitAppendError(
    requestId: string,
    code: "agent_not_found" | "agent_archived" | "invalid_target",
    message: string,
  ): void {
    this.host.emit({
      type: "agent.notebook.append.response",
      payload: {
        requestId,
        result: {
          status: "error",
          code,
          message,
        },
      },
    });
  }
}
