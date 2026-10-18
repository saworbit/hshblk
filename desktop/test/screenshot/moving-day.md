# Moving the database

The move is on **Tuesday at 7 am**, before anyone is awake enough to object. Read this before then, not _during_. The [runbook](https://example.com/runbook) has the long version.

## Steps

- [x] Snapshot the old cluster
- [x] Restore it to staging, and check the row counts
- [ ] Point `api` at the new cluster
- [ ] Watch the error rate for an hour

```mermaid
flowchart LR
  A[Snapshot] --> B[Restore] --> C[Check the counts] --> D[Switch over]
```

| Table    |       Rows |   Size |
| -------- | ---------: | -----: |
| `users`  |     48,210 |  12 MB |
| `orders` |  1,204,377 | 640 MB |
| `events` | 98,551,002 |  41 GB |

At 120 MB/s that is $\frac{41.6\ \text{GB}}{120\ \text{MB/s}} \approx 6$ minutes, plus however long it takes to find the right terminal.

> [!WARNING]
> If the error rate doubles, roll back first and ask questions after.

```bash
# Put it back the way it was
kubectl rollout undo deployment/api --to-revision=41
```
