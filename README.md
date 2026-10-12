# Boardroom

Boardroom coordinates temporary AI development sessions across GitHub repositories.

**Status:** Architecture and implementation planning. No deployed application or scheduled-agent integration is claimed.

Core requirements: one active authorized development session per repository; priority-first assignment followed by least-recently-updated selection; a private Owner Action Board; a work-only Coffee Corner; durable GitHub handoffs; crash-safe leases and authorization; and model-independent agent adapters.

The development roadmap will be kept in `registry/roadmap.json`. No credentials, personal data, or owner-action secrets belong in this repository. The operational dashboard and Owner Action Board must be privately authenticated even though this source repository is public.
