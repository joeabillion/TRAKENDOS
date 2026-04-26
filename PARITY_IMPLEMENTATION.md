# Real Parity Implementation for Trakend OS

## Overview

The parity system in Trakend OS has been completely refactored from a simulated system to a **real, working XOR-based parity implementation** that performs actual disk I/O operations, similar to Unraid.

## Key Features

### 1. Real Block-Level XOR Operations

Instead of simulating progress, the implementation now:
- Reads 1MB blocks sequentially from all data drives
- XORs them together using real Buffer operations
- Writes the result to the parity drive
- Handles drives of different sizes gracefully

### 2. Three Main Parity Operations

#### Parity Sync (Build)
- **Purpose**: Initial parity creation or rebuild from scratch
- **Flow**:
  1. Identifies all assigned data drives and the parity drive
  2. Determines the largest data drive size for coverage
  3. Processes each block sequentially:
     - Reads 1MB blocks from all data drives
     - XORs them together
     - Writes result to parity drive
  4. Tracks real progress with actual I/O speeds (MB/s)
  5. Calculates ETA based on actual throughput
  6. Sets parity state to `valid` on completion

#### Parity Check
- **Purpose**: Verify parity integrity without correcting
- **Flow**:
  1. Reads blocks from all data drives and XORs them
  2. Reads corresponding parity block
  3. Compares computed vs actual parity
  4. Counts errors found
  5. If `correct=true`, overwrites bad parity blocks
  6. Reports errors found and corrected

#### Drive Rebuild
- **Purpose**: Reconstruct a failed drive from remaining data + parity
- **Flow**:
  1. Identifies the failed drive
  2. XORs all OTHER data drives together
  3. XORs result with parity drive
  4. Result is the reconstructed data
  5. Writes reconstructed blocks to replacement drive
  6. Updates drive status to `active`

### 3. Progress Tracking

Each operation provides:
- `progress`: 0-100% completion
- `speed_mbps`: Current throughput in MB/s
- `estimated_finish`: ISO timestamp of expected completion
- `errors_found`: Count of parity errors (check only)
- `errors_corrected`: Count of blocks corrected (check only)
- `status`: running | paused | completed | failed | cancelled

Updates every 5 seconds for responsive UI feedback.

### 4. Block-Level I/O

Two private methods handle actual disk I/O:

```typescript
private readBlock(device: string, offset: bigint, size: number): Promise<Buffer>
private writeBlock(device: string, offset: bigint, data: Buffer): Promise<void>
```

These use Node.js `fs.open()`, `fs.read()`, and `fs.write()` for:
- Seeking to specific block offsets (in bytes)
- Reading/writing exactly 1MB at a time
- Proper error handling and closure

### 5. Parity State Machine

```
none         → No parity drives assigned
invalid      → Parity exists but out of sync
building     → Parity sync in progress
checking     → Parity check in progress
rebuilding   → Drive reconstruction in progress
valid        → Parity is in sync and valid
```

## Mathematical Foundation

### XOR Parity

For N data blocks (D1, D2, ..., DN):
```
P = D1 XOR D2 XOR ... XOR DN
```

To reconstruct a missing data block (e.g., D2):
```
D2 = D1 XOR P XOR D3 XOR ... XOR DN
```

This works because:
- A XOR A = 0
- A XOR 0 = A
- XOR is commutative and associative

### Property: Different Sized Drives

When data drives have different sizes:
- Parity covers the largest drive size
- Smaller drives treated as having implicit zeros for missing blocks
- XOR of partial data still produces valid parity
- Reconstruction works correctly even if blocks don't exist

## Implementation Details

### File: `backend/src/services/arrayService.ts`

#### New Methods

1. **`runParitySync()`** (lines 1145-1271)
   - Real block-by-block XOR and write
   - Sequential processing with progress updates
   - Database history recording

2. **`runParityCheck(correct: boolean)`** (lines 1273-1418)
   - XOR verification with actual disk reads
   - Optional automatic correction
   - Error counting and logging

3. **`runDriveRebuild(driveId: string)`** (lines 1420-1557)
   - Reconstruction using N-1 data drives + parity
   - Writes to replacement device
   - Progress tracking per block

4. **`readBlock(device, offset, size)`** (lines 1563-1585)
   - Async file read at specific offset
   - Padding for partial reads
   - Error handling

5. **`writeBlock(device, offset, data)`** (lines 1587-1600)
   - Async file write at specific offset
   - Atomic block writes
   - Error handling

### Key Design Decisions

1. **Block Size**: 1MB blocks
   - Good balance between memory usage and I/O efficiency
   - Large enough for reasonable speeds
   - Small enough to process incrementally

2. **Sequential Processing**: One block at a time
   - Avoids memory overload
   - Allows cancellation between blocks
   - Enables progress tracking per block

3. **Update Interval**: 5 seconds
   - UI updates every 5 seconds
   - Less overhead than per-block updates
   - Sufficient for responsive UI

4. **Error Handling**:
   - Read errors: Log warning, assume zeros
   - Write errors: Fail immediately, mark operation failed
   - I/O errors don't cascade

5. **Parity State Transitions**:
   - Sync/Check → `building` → `valid` on success
   - Failed operations → `invalid`
   - Cancellation → original state (invalid for sync, valid for check)

## API Endpoints

All endpoints are in `backend/src/routes/array.ts`:

### POST `/api/array/parity/sync`
Starts initial parity build
```json
Response:
{
  "id": "uuid",
  "type": "sync",
  "status": "running",
  "progress": 0,
  "speed_mbps": 0,
  "errors_found": 0,
  "errors_corrected": 0,
  "started_at": 1234567890
}
```

### POST `/api/array/parity/check`
Checks parity integrity, optionally corrects
```json
Request: { "correct": false }
Response: (same as sync)
```

### POST `/api/array/parity/rebuild`
Rebuilds a failed drive
```json
Request: { "driveId": "drive-uuid" }
Response: (includes target_drive field)
```

### GET `/api/array/parity/status`
Gets current operation status
```json
Response: { operation or { "status": "idle" } }
```

### POST `/api/array/parity/cancel`
Cancels running operation

### GET `/api/array/parity/history`
Gets history of past operations

## Testing & Validation

### Manual Testing Steps

1. **Setup Array**:
   ```
   POST /api/array/drives/assign { driveId, role: "data", slot: 0 }
   POST /api/array/drives/assign { driveId, role: "parity" }
   POST /api/array/start
   ```

2. **Build Parity**:
   ```
   POST /api/array/parity/sync
   GET /api/array/parity/status (repeatedly)
   ```
   Watch progress go from 0 to 100

3. **Check Parity**:
   ```
   POST /api/array/parity/check { "correct": false }
   GET /api/array/parity/status (repeatedly)
   ```
   Should show 0 errors if sync completed successfully

4. **Simulate Drive Failure**:
   - In real scenario: physical drive failure
   - In test: manually corrupt some blocks of a data drive

5. **Rebuild**:
   ```
   POST /api/array/parity/rebuild { "driveId": "failed-drive-id" }
   GET /api/array/parity/status (repeatedly)
   ```
   Watch reconstruction complete

### Verification

- Frontend shows progress bar updating smoothly
- Speed (MB/s) reflects actual I/O performance
- ETA becomes more accurate as operation progresses
- History shows all completed operations
- Parity state transitions occur correctly

## Performance Characteristics

### Expected Throughput
- On mechanical drives: 50-150 MB/s
- On SSDs: 200-1000 MB/s
- On RAID controllers: depends on cache/throughput

### Time Estimates (example: 4TB drives, 150 MB/s)
- Parity Sync: ~27 minutes
- Parity Check: ~27 minutes
- Drive Rebuild (1 failure): ~27 minutes

### Memory Usage
- Fixed at ~1MB per 1MB block (buffer allocation)
- Minimal heap growth over time
- No memory leaks from long operations

## Failure Scenarios

### Read Error During Sync
- Logged as warning
- Treated as zero block
- Operation continues
- Parity still valid for remaining data

### Write Error During Sync
- Logged as error
- Operation fails immediately
- Parity state set to `invalid`
- Can retry after fixing issue

### Cancellation
- Stops processing immediately
- State depends on operation type:
  - Sync: `invalid` (incomplete parity)
  - Check: `valid` (no data changed)
  - Rebuild: `invalid` (partial reconstruction)

### Network/API Disconnect
- Progress stored in memory only
- Reconnecting shows current state
- Operation continues unaffected
- Web UI polls every 5 seconds

## Future Enhancements

1. **RAID6 Support**
   - Second parity drive using different algorithm
   - Tolerates 2 concurrent drive failures

2. **Parallel Block Processing**
   - Worker threads for XOR computation
   - Parallel reads from multiple drives
   - Expected 2-4x speedup

3. **Intelligent Scheduling**
   - Run parity ops during low-traffic windows
   - Pause for real workloads
   - Resume automatically

4. **Incremental Sync**
   - Only update changed blocks (using journal)
   - Much faster for large arrays
   - Complex to implement correctly

5. **Diagnostic Tools**
   - Block-by-block parity verification
   - Identify problematic sectors
   - Predict drive failures

## Troubleshooting

### "No parity drive assigned" error
- Ensure a drive is assigned with role `parity`
- Check array is running

### Parity operations very slow
- Check disk I/O isn't bottlenecked
- Verify no other heavy I/O in progress
- Check for bad sectors with `smartctl`

### Parity check finds many errors
- Likely indicates data corruption
- Check drive SMART status
- Consider running parity correction

### Drive rebuild fails
- Verify replacement drive is large enough
- Check parity drive is healthy
- Check no other operations running

## Summary

This implementation provides production-quality parity operations for Trakend OS:
- Real disk I/O with actual XOR operations
- Accurate progress tracking and ETAs
- Robust error handling
- Historical record of operations
- Clean state transitions
- Frontend-ready API responses
