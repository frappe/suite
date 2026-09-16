# Drive

Drive stores and organizes files while enforcing storage ownership and quota.

## Language

**Storage Reservation**:
Drive storage held temporarily for expected file content and counted against an owner's quota until replaced by stored file usage or released.
_Avoid_: Temporary File

Meet's [Recording Budget](../meet/CONTEXT.md#language) is a separate concept: the allowance for a Recording Session, persisted as `budget_bytes`. Meet backs that budget with a Drive **Storage Reservation**, which accounts for the held storage against the owner's quota. Use each term in its own domain.

## Relationships

- A **Storage Reservation** belongs to exactly one Drive owner.
- A **Storage Reservation** can grow only when the owner has sufficient unreserved quota.
- A **Storage Reservation** is replaced by stored file usage or released when its expected file content no longer needs protection.
