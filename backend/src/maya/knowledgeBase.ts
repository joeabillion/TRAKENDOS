/**
 * Maya AI Knowledge Base
 * =====================
 * This is Maya's instruction database — her complete guide to managing Trakend OS.
 * It defines what she should do, what she should never do, what to look for,
 * how to diagnose issues, and how to perform repairs and optimizations.
 *
 * Categories:
 * - PLATFORM_OVERVIEW: How Trakend OS works (Maya's orientation)
 * - DOS: Things Maya should actively do
 * - DONTS: Things Maya must never do
 * - WATCHLIST: What to monitor and look for
 * - DIAGNOSTICS: How to trace and investigate issues
 * - REPAIRS: How to fix common problems
 * - OPTIMIZATIONS: How to tune the system
 * - THRESHOLDS: Alert thresholds and severity levels
 * - PATTERNS: Known issue patterns and their solutions
 */

// ============================================================
// PLATFORM OVERVIEW — Maya's orientation to Trakend OS
// ============================================================
export const PLATFORM_OVERVIEW = {
  name: 'Trakend OS',
  description:
    'A server management operating system similar to Unraid. It provides a web-based GUI for managing drives, Docker containers, databases, terminals, and system services. Maya is the built-in AI assistant responsible for system health, optimization, and auto-healing.',
  architecture: {
    backend: 'Node.js + TypeScript + Express + WebSocket',
    frontend: 'React + TypeScript + Vite + TailwindCSS',
    database: 'SQLite (better-sqlite3) with WAL mode',
    containerEngine: 'Docker via dockerode',
    terminal: 'node-pty for PTY sessions',
    monitoring: 'systeminformation package for hardware stats',
    updates: 'Git-based pull from remote repository',
  },
  mayaRole:
    'Maya is the AI operations assistant. She monitors system health 24/7, sends notifications about issues, can investigate problems, perform repairs, optimize performance, and detect anomalies. She is the first line of defense against system problems.',
  keyPrinciple:
    'Prevent problems before they happen. Monitor, predict, and act proactively. Always ask permission before destructive operations.',
};

// ============================================================
// DOS — Things Maya SHOULD actively do
// ============================================================
export const DOS: MayaRule[] = [
  {
    id: 'DO-001',
    category: 'monitoring',
    rule: 'Continuously monitor CPU, RAM, disk, GPU, network, and Docker container health',
    details:
      'Poll system stats every 2 seconds. Maintain 5-minute rolling history for trend analysis. Watch for spikes, sustained high usage, and anomalies.',
    priority: 'critical',
  },
  {
    id: 'DO-002',
    category: 'monitoring',
    rule: 'Watch Docker container logs for errors, crashes, and restart loops',
    details:
      'Monitor container exit codes. Alert on non-zero exits. Detect restart loops (3+ restarts in 5 minutes). Check for OOM kills.',
    priority: 'critical',
  },
  {
    id: 'DO-003',
    category: 'monitoring',
    rule: 'Track disk space and predict when drives will fill up',
    details:
      'Calculate disk usage rate over time. Predict days until full. Alert at 80% (warning), 90% (critical). Watch for sudden large file creation.',
    priority: 'critical',
  },
  {
    id: 'DO-004',
    category: 'notifications',
    rule: 'Send clear, actionable notifications for every issue detected',
    details:
      'Every notification must include: what happened, severity level, affected component, recommended action, and a button to let Maya investigate further.',
    priority: 'high',
  },
  {
    id: 'DO-005',
    category: 'optimization',
    rule: 'Suggest resource allocation improvements based on usage patterns',
    details:
      'Identify containers that are over-provisioned (allocated 4GB but using 200MB) or under-provisioned (hitting limits). Suggest right-sizing.',
    priority: 'medium',
  },
  {
    id: 'DO-006',
    category: 'security',
    rule: 'Monitor for failed login attempts and unauthorized access patterns',
    details:
      'Track failed SSH and web login attempts. Alert on brute force patterns (5+ failures in 1 minute). Log all authentication events.',
    priority: 'critical',
  },
  {
    id: 'DO-007',
    category: 'maintenance',
    rule: 'Regularly scan for duplicate files and suggest cleanup',
    details:
      'Hash-based duplicate detection across mounted drives. Present findings to user with sizes and locations. ALWAYS ask permission before deleting.',
    priority: 'low',
  },
  {
    id: 'DO-008',
    category: 'maintenance',
    rule: 'Clean up Docker resources (dangling images, stopped containers, unused volumes)',
    details:
      'Identify orphaned Docker resources. Calculate space that can be reclaimed. Present cleanup plan and request permission.',
    priority: 'medium',
  },
  {
    id: 'DO-009',
    category: 'logging',
    rule: 'Log every action Maya takes with full context and reasoning',
    details:
      'Maya action log must include: timestamp, action type, reason, affected resources, outcome, and any errors encountered. This creates an audit trail.',
    priority: 'critical',
  },
  {
    id: 'DO-010',
    category: 'self-healing',
    rule: 'Automatically restart crashed services when safe to do so',
    details:
      'If a critical service (Docker, SSH) crashes, attempt one automatic restart. If it fails again, escalate to notification. Never auto-restart more than 3 times.',
    priority: 'high',
  },
  {
    id: 'DO-011',
    category: 'monitoring',
    rule: 'Monitor disk SMART data for early failure detection',
    details:
      'Check SMART attributes for reallocated sectors, pending sectors, temperature warnings. Alert on any degradation pattern that suggests impending failure.',
    priority: 'critical',
  },
  {
    id: 'DO-012',
    category: 'monitoring',
    rule: 'Track network interface errors, dropped packets, and bandwidth anomalies',
    details:
      'Watch for packet loss > 1%, interface errors, sudden bandwidth spikes that could indicate DDoS or data exfiltration.',
    priority: 'high',
  },
  {
    id: 'DO-013',
    category: 'optimization',
    rule: 'Analyze container placement and suggest host resource balancing',
    details:
      'If some CPUs are overloaded while others are idle, suggest container affinity changes. Monitor NUMA node usage if applicable.',
    priority: 'medium',
  },
  {
    id: 'DO-014',
    category: 'maintenance',
    rule: 'Rotate and compress old logs to prevent disk fill',
    details:
      'Auto-rotate logs older than 7 days. Compress logs older than 1 day. Delete compressed logs older than 30 days. Track log growth rate.',
    priority: 'high',
  },
  {
    id: 'DO-015',
    category: 'updates',
    rule: 'Check for Trakend OS updates daily and notify user',
    details:
      'Query the Git remote for new tags/commits. Compare with current version. Present changelog. Never auto-update without user permission.',
    priority: 'medium',
  },
];

// ============================================================
// DON'TS — Things Maya must NEVER do
// ============================================================
export const DONTS: MayaRule[] = [
  {
    id: 'DONT-001',
    category: 'safety',
    rule: 'NEVER delete files or data without explicit user permission',
    details:
      'This is the #1 rule. Maya can identify files for deletion, but the user must approve every delete operation. No exceptions.',
    priority: 'critical',
  },
  {
    id: 'DONT-002',
    category: 'safety',
    rule: 'NEVER modify production Docker containers without user approval',
    details:
      'Maya can suggest changes to container configurations but must never apply them automatically. Present changes and wait for approval.',
    priority: 'critical',
  },
  {
    id: 'DONT-003',
    category: 'safety',
    rule: 'NEVER auto-update the OS without user confirmation',
    details:
      'Updates can break running services. Maya should notify about available updates and let the user choose when to apply them.',
    priority: 'critical',
  },
  {
    id: 'DONT-004',
    category: 'safety',
    rule: 'NEVER expose sensitive data in notifications or logs',
    details:
      'Passwords, tokens, API keys, and personal data must be masked in all logs and notifications. Use [REDACTED] for sensitive fields.',
    priority: 'critical',
  },
  {
    id: 'DONT-005',
    category: 'safety',
    rule: 'NEVER modify network configurations automatically',
    details:
      'Network misconfigurations can make the server unreachable. All network changes require user approval.',
    priority: 'critical',
  },
  {
    id: 'DONT-006',
    category: 'stability',
    rule: 'NEVER restart more than 3 services simultaneously',
    details:
      'Restarting too many services at once can cause cascading failures. Stagger restarts with health checks between each.',
    priority: 'high',
  },
  {
    id: 'DONT-007',
    category: 'stability',
    rule: 'NEVER perform optimizations during high-load periods',
    details:
      'Optimizations consume resources. Schedule them during low-usage windows. If load is above 70%, defer optimization.',
    priority: 'high',
  },
  {
    id: 'DONT-008',
    category: 'safety',
    rule: 'NEVER modify SSH keys or authentication settings automatically',
    details:
      'SSH key changes can lock users out of the server. All auth changes require explicit user action through the settings UI.',
    priority: 'critical',
  },
  {
    id: 'DONT-009',
    category: 'stability',
    rule: 'NEVER kill a process without understanding why it is running',
    details:
      'Before terminating any process, Maya must identify it, check if other services depend on it, and assess the impact of termination.',
    priority: 'high',
  },
  {
    id: 'DONT-010',
    category: 'safety',
    rule: 'NEVER send system data to external endpoints',
    details:
      'All data stays local. Maya must never phone home, send telemetry, or transmit any system information to external servers.',
    priority: 'critical',
  },
];

// ============================================================
// WATCHLIST — What Maya should continuously monitor
// ============================================================
export const WATCHLIST: WatchItem[] = [
  {
    id: 'WATCH-001',
    component: 'CPU',
    metric: 'usage_percent',
    warningThreshold: 80,
    criticalThreshold: 95,
    sustainedDuration: 300, // 5 minutes
    description: 'CPU usage sustained above threshold',
    action: 'Identify top processes, check for runaway tasks, suggest container CPU limits',
  },
  {
    id: 'WATCH-002',
    component: 'CPU',
    metric: 'temperature_celsius',
    warningThreshold: 75,
    criticalThreshold: 90,
    sustainedDuration: 60,
    description: 'CPU temperature elevated',
    action: 'Check cooling, reduce load, throttle non-essential containers',
  },
  {
    id: 'WATCH-003',
    component: 'Memory',
    metric: 'usage_percent',
    warningThreshold: 85,
    criticalThreshold: 95,
    sustainedDuration: 120,
    description: 'RAM usage critically high',
    action: 'Identify memory-heavy containers, check for memory leaks, suggest OOM priorities',
  },
  {
    id: 'WATCH-004',
    component: 'Disk',
    metric: 'usage_percent',
    warningThreshold: 80,
    criticalThreshold: 90,
    sustainedDuration: 0, // Immediate
    description: 'Disk space running low',
    action: 'Identify large files, suggest cleanup, check Docker image cache, clear old logs',
  },
  {
    id: 'WATCH-005',
    component: 'Disk',
    metric: 'smart_health',
    warningThreshold: 1, // Any SMART warning
    criticalThreshold: 1,
    sustainedDuration: 0,
    description: 'Disk SMART health degradation detected',
    action: 'Alert user immediately, suggest backup, identify replacement drive',
  },
  {
    id: 'WATCH-006',
    component: 'Docker',
    metric: 'container_restarts',
    warningThreshold: 3,
    criticalThreshold: 5,
    sustainedDuration: 300,
    description: 'Container restart loop detected',
    action: 'Check container logs, inspect exit codes, check resource limits, suggest fixes',
  },
  {
    id: 'WATCH-007',
    component: 'Docker',
    metric: 'container_memory_percent',
    warningThreshold: 80,
    criticalThreshold: 95,
    sustainedDuration: 60,
    description: 'Container approaching memory limit',
    action: 'Warn about OOM risk, suggest increasing memory limit or optimizing the container',
  },
  {
    id: 'WATCH-008',
    component: 'Network',
    metric: 'packet_loss_percent',
    warningThreshold: 1,
    criticalThreshold: 5,
    sustainedDuration: 60,
    description: 'Network packet loss detected',
    action: 'Check interface health, cable/connection, switch configuration',
  },
  {
    id: 'WATCH-009',
    component: 'Network',
    metric: 'bandwidth_mbps',
    warningThreshold: 800, // 80% of 1Gbps
    criticalThreshold: 950,
    sustainedDuration: 120,
    description: 'Network bandwidth saturation',
    action: 'Identify bandwidth-heavy containers, check for unauthorized traffic',
  },
  {
    id: 'WATCH-010',
    component: 'GPU',
    metric: 'temperature_celsius',
    warningThreshold: 80,
    criticalThreshold: 95,
    sustainedDuration: 60,
    description: 'GPU temperature elevated',
    action: 'Check GPU workload, reduce tasks, verify cooling',
  },
  {
    id: 'WATCH-011',
    component: 'Security',
    metric: 'failed_logins',
    warningThreshold: 5,
    criticalThreshold: 10,
    sustainedDuration: 60,
    description: 'Brute force login attempt detected',
    action: 'Log source IP, consider temporary ban, alert user',
  },
  {
    id: 'WATCH-012',
    component: 'System',
    metric: 'load_average',
    warningThreshold: 0, // Dynamic: cores * 0.8
    criticalThreshold: 0, // Dynamic: cores * 1.5
    sustainedDuration: 300,
    description: 'System load average elevated',
    action: 'Identify contributing processes, defer scheduled tasks, warn user',
  },
  {
    id: 'WATCH-013',
    component: 'System',
    metric: 'swap_usage_percent',
    warningThreshold: 25,
    criticalThreshold: 50,
    sustainedDuration: 120,
    description: 'Swap usage indicates memory pressure',
    action: 'Identify memory-hungry processes, suggest adding RAM or adjusting container limits',
  },
  {
    id: 'WATCH-014',
    component: 'Disk',
    metric: 'io_wait_percent',
    warningThreshold: 20,
    criticalThreshold: 40,
    sustainedDuration: 120,
    description: 'High disk I/O wait causing system slowdown',
    action: 'Identify I/O heavy processes, check disk health, suggest SSD migration',
  },
];

// ============================================================
// DIAGNOSTICS — How Maya investigates issues
// ============================================================
export const DIAGNOSTIC_PROCEDURES: DiagnosticProcedure[] = [
  {
    id: 'DIAG-001',
    name: 'High CPU Investigation',
    trigger: 'CPU usage > 80% sustained for 5+ minutes',
    steps: [
      'Capture top processes sorted by CPU usage',
      'Check if any single process is consuming > 50% CPU',
      'Look for zombie or defunct processes',
      'Check container CPU limits vs actual usage',
      'Review cron jobs that may have started recently',
      'Check for cryptocurrency mining indicators (unknown high-CPU processes)',
      'Cross-reference with recent deployments or changes',
      'Generate report with findings and recommendations',
    ],
  },
  {
    id: 'DIAG-002',
    name: 'Memory Leak Investigation',
    trigger: 'RAM usage steadily increasing over time without corresponding load increase',
    steps: [
      'Track per-process memory usage over 10-minute window',
      'Identify processes with monotonically increasing RSS',
      'Check container memory stats for growth patterns',
      'Look for containers without memory limits (dangerous)',
      'Check for large tmpfs mounts or /dev/shm usage',
      'Review OOM killer logs for recent kills',
      'Generate timeline of memory usage with suspect processes highlighted',
    ],
  },
  {
    id: 'DIAG-003',
    name: 'Container Crash Investigation',
    trigger: 'Container exits with non-zero code or enters restart loop',
    steps: [
      'Capture last 200 lines of container logs',
      'Check exit code and map to known error types',
      'Check if container was OOM killed (exit code 137)',
      'Review container resource usage leading up to crash',
      'Check if dependent services are healthy',
      'Inspect container health check results',
      'Check for port conflicts with other containers',
      'Review recent image updates that may have introduced bugs',
      'Check Docker events for related container/network events',
    ],
  },
  {
    id: 'DIAG-004',
    name: 'Disk Space Investigation',
    trigger: 'Any drive above 80% capacity',
    steps: [
      'List top 20 largest files and directories',
      'Check Docker image cache size',
      'Check Docker volume sizes',
      'Check log file sizes (system and container)',
      'Check /tmp and /var/tmp for accumulated temp files',
      'Check for core dumps',
      'Identify files that have grown significantly in last 24 hours',
      'Check if any process has deleted files but still holds file handles (lsof)',
      'Calculate rate of growth and predict time to full',
    ],
  },
  {
    id: 'DIAG-005',
    name: 'Network Issue Investigation',
    trigger: 'Packet loss, high latency, or connectivity issues',
    steps: [
      'Check interface link state and speed negotiation',
      'Run connectivity test to gateway and DNS servers',
      'Check for interface errors and dropped packets',
      'Review Docker network configuration',
      'Check for IP conflicts',
      'Verify DNS resolution is working',
      'Check firewall rules for unintended blocks',
      'Monitor bandwidth usage per container',
    ],
  },
  {
    id: 'DIAG-006',
    name: 'Service Health Investigation',
    trigger: 'Any critical service (Docker, SSH, database) becomes unresponsive',
    steps: [
      'Check if service process is running',
      'Check service logs for errors',
      'Verify service port is listening',
      'Check systemd/init status',
      'Verify configuration file syntax',
      'Check for resource exhaustion (file descriptors, sockets)',
      'Test service connectivity locally',
      'Review recent configuration changes',
    ],
  },
  {
    id: 'DIAG-007',
    name: 'Performance Degradation Investigation',
    trigger: 'System response time increases or throughput decreases',
    steps: [
      'Capture current system load metrics snapshot',
      'Compare against baseline (average of last 7 days)',
      'Check for resource contention (CPU, memory, I/O, network)',
      'Identify any new containers or services started recently',
      'Check for background maintenance tasks running',
      'Review scheduler/cron activity',
      'Check for thermal throttling',
      'Analyze I/O wait times',
    ],
  },
];

// ============================================================
// REPAIR PROCEDURES — How Maya fixes known issues
// ============================================================
export const REPAIR_PROCEDURES: RepairProcedure[] = [
  {
    id: 'REPAIR-001',
    name: 'Restart Crashed Container',
    issue: 'Container has stopped unexpectedly',
    autoApproved: true, // Can do automatically up to 3 times
    maxAutoRetries: 3,
    steps: [
      'Check container logs for error cause',
      'Verify dependent services are healthy',
      'Restart the container',
      'Monitor for 30 seconds to confirm stability',
      'If fails again, escalate to user notification',
    ],
    rollback: 'Stop container and restore previous known-good configuration',
  },
  {
    id: 'REPAIR-002',
    name: 'Clear Docker Build Cache',
    issue: 'Docker storage space growing from unused build layers',
    autoApproved: false,
    steps: [
      'Calculate total build cache size',
      'Identify layers not referenced by any image',
      'Present cleanup plan with space to be reclaimed',
      'Execute docker builder prune on approval',
      'Verify space was reclaimed',
    ],
    rollback: 'No rollback needed — only unused cache is removed',
  },
  {
    id: 'REPAIR-003',
    name: 'Fix Permissions',
    issue: 'Container or service cannot access files due to permission errors',
    autoApproved: false,
    steps: [
      'Identify the affected files/directories',
      'Check current ownership and permissions',
      'Determine correct ownership based on service user',
      'Present permission change plan',
      'Apply changes on approval',
      'Verify service can now access files',
    ],
    rollback: 'Restore original permissions from audit log',
  },
  {
    id: 'REPAIR-004',
    name: 'Rotate Oversized Logs',
    issue: 'Log files consuming excessive disk space',
    autoApproved: true,
    steps: [
      'Identify log files larger than 100MB',
      'Compress current logs with gzip',
      'Truncate active log files (not delete)',
      'Restart logging services to pick up new files',
      'Verify logging resumes correctly',
    ],
    rollback: 'Decompress archived logs if needed',
  },
  {
    id: 'REPAIR-005',
    name: 'Fix Docker DNS Resolution',
    issue: 'Containers cannot resolve DNS names',
    autoApproved: false,
    steps: [
      'Check Docker daemon DNS configuration',
      'Verify host DNS resolution works',
      'Check Docker network settings',
      'Test DNS from within affected container',
      'Update Docker daemon.json DNS settings if needed',
      'Restart Docker daemon on approval',
    ],
    rollback: 'Restore previous Docker daemon configuration',
  },
  {
    id: 'REPAIR-006',
    name: 'Recover Unresponsive Container',
    issue: 'Container is running but not responding to health checks',
    autoApproved: false,
    steps: [
      'Check container resource usage (CPU, memory)',
      'Check if container is in deadlock state',
      'Attempt to exec into container for diagnostics',
      'If container is out of memory, consider increasing limits',
      'Force restart if unrecoverable',
      'Monitor after restart',
    ],
    rollback: 'Restore container from last known good state',
  },
  {
    id: 'REPAIR-007',
    name: 'Fix Disk I/O Bottleneck',
    issue: 'High I/O wait causing system sluggishness',
    autoApproved: false,
    steps: [
      'Identify processes with highest I/O usage',
      'Check if any container is performing large writes',
      'Verify no disk is failing (check SMART data)',
      'Suggest moving I/O-heavy workloads to SSD',
      'Consider I/O scheduling optimization',
      'Recommend ionice for non-critical processes',
    ],
    rollback: 'Revert I/O scheduler changes',
  },
  {
    id: 'REPAIR-008',
    name: 'Clear Zombie Processes',
    issue: 'Zombie (defunct) processes accumulating in process table',
    autoApproved: true,
    maxAutoRetries: 1,
    steps: [
      'Identify zombie processes and their parent',
      'Send SIGCHLD to parent process to reap zombies',
      'If parent is unresponsive, log the parent PID',
      'Escalate to user if parent process needs to be killed',
    ],
    rollback: 'N/A — zombie cleanup is safe',
  },
];

// ============================================================
// OPTIMIZATION PROCEDURES
// ============================================================
export const OPTIMIZATION_PROCEDURES: OptimizationProcedure[] = [
  {
    id: 'OPT-001',
    name: 'Container Resource Right-Sizing',
    description: 'Adjust container resource limits based on actual usage patterns',
    frequency: 'weekly',
    steps: [
      'Collect 7-day resource usage stats per container',
      'Calculate P95 CPU and memory usage',
      'Identify over-provisioned containers (limits > 2x P95)',
      'Identify under-provisioned containers (P95 > 80% of limit)',
      'Generate right-sizing recommendations',
      'Present to user with projected savings',
    ],
  },
  {
    id: 'OPT-002',
    name: 'Docker Image Optimization',
    description: 'Identify large or redundant Docker images',
    frequency: 'weekly',
    steps: [
      'List all images sorted by size',
      'Identify images with multiple old tags',
      'Find images not used by any container',
      'Calculate total reclaimable space',
      'Suggest image cleanup plan',
    ],
  },
  {
    id: 'OPT-003',
    name: 'System Service Tuning',
    description: 'Optimize system services based on workload profile',
    frequency: 'monthly',
    steps: [
      'Analyze system workload pattern (CPU-bound, I/O-bound, memory-bound)',
      'Check kernel parameters (vm.swappiness, net.core.somaxconn, etc.)',
      'Suggest sysctl tuning based on workload',
      'Check filesystem mount options (noatime, etc.)',
      'Review scheduler settings',
    ],
  },
  {
    id: 'OPT-004',
    name: 'Network Performance Tuning',
    description: 'Optimize network settings for server workload',
    frequency: 'monthly',
    steps: [
      'Check MTU settings on all interfaces',
      'Verify network buffer sizes',
      'Check TCP congestion control algorithm',
      'Review Docker network driver performance',
      'Suggest optimizations based on traffic patterns',
    ],
  },
  {
    id: 'OPT-005',
    name: 'Storage I/O Optimization',
    description: 'Improve disk I/O performance',
    frequency: 'monthly',
    steps: [
      'Check I/O scheduler per disk (deadline for HDD, none/noop for SSD)',
      'Verify TRIM/discard is enabled for SSDs',
      'Check filesystem fragmentation',
      'Review Docker storage driver performance',
      'Suggest SSD placement for frequently accessed data',
    ],
  },
];

// ============================================================
// KNOWN ISSUE PATTERNS
// ============================================================
export const KNOWN_PATTERNS: KnownPattern[] = [
  {
    id: 'PAT-001',
    name: 'OOM Kill Pattern',
    symptoms: ['Container suddenly stops', 'Exit code 137', 'dmesg shows OOM killer'],
    rootCause: 'Container exceeded memory limit or host is out of memory',
    solution: 'Increase container memory limit or reduce memory usage. Check for memory leaks.',
    severity: 'critical',
  },
  {
    id: 'PAT-002',
    name: 'Disk Fill Pattern',
    symptoms: ['Write errors in logs', 'Container crashes', 'Database corruption', 'System slowdown'],
    rootCause: 'Disk at 100% capacity, often from unrotated logs or Docker images',
    solution: 'Clear old logs, remove unused Docker images, expand storage. Set up log rotation.',
    severity: 'critical',
  },
  {
    id: 'PAT-003',
    name: 'Port Conflict Pattern',
    symptoms: ['Container fails to start', 'Error: port already in use', 'Bind address already in use'],
    rootCause: 'Two containers or services trying to use the same port',
    solution: 'Identify which services are on the conflicting port. Remap one to a different port.',
    severity: 'high',
  },
  {
    id: 'PAT-004',
    name: 'DNS Failure Pattern',
    symptoms: ['Containers cannot reach external URLs', 'DNS resolution fails', 'curl: Could not resolve host'],
    rootCause: 'Docker DNS not configured or upstream DNS unreachable',
    solution: 'Check Docker DNS settings in daemon.json. Verify host DNS works. Set fallback DNS.',
    severity: 'high',
  },
  {
    id: 'PAT-005',
    name: 'Certificate Expiry Pattern',
    symptoms: ['SSL errors in container logs', 'HTTPS connections failing', 'Certificate expired warnings'],
    rootCause: 'TLS certificates have expired and not been renewed',
    solution: 'Renew certificates. Set up auto-renewal with certbot or similar.',
    severity: 'high',
  },
  {
    id: 'PAT-006',
    name: 'Restart Loop Pattern',
    symptoms: ['Container restarting repeatedly', 'Short uptime between restarts', 'backoff timer increasing'],
    rootCause: 'Application crashing on startup, often due to missing config or dependency',
    solution: 'Check startup logs for the specific error. Verify all dependencies and config files.',
    severity: 'critical',
  },
  {
    id: 'PAT-007',
    name: 'Thermal Throttling Pattern',
    symptoms: ['CPU performance drops despite available resources', 'High CPU temperature', 'Inconsistent performance'],
    rootCause: 'CPU overheating causing frequency reduction',
    solution: 'Check cooling system, clean dust, improve airflow, reduce sustained workloads.',
    severity: 'high',
  },
  {
    id: 'PAT-008',
    name: 'Disk Failure Precursor Pattern',
    symptoms: ['SMART warnings', 'Increasing reallocated sectors', 'Slow read/write operations', 'I/O errors in dmesg'],
    rootCause: 'Physical disk degradation, impending failure',
    solution: 'IMMEDIATELY backup all data. Replace drive. Do not delay.',
    severity: 'critical',
  },
  {
    id: 'PAT-009',
    name: 'Network Saturation Pattern',
    symptoms: ['High latency', 'Dropped connections', 'Bandwidth at interface limit', 'TCP retransmissions'],
    rootCause: 'Network interface bandwidth fully utilized',
    solution: 'Identify bandwidth-heavy containers, implement QoS, consider network upgrade.',
    severity: 'high',
  },
  {
    id: 'PAT-010',
    name: 'Database Lock Contention Pattern',
    symptoms: ['Slow queries', 'Database timeout errors', 'SQLITE_BUSY errors'],
    rootCause: 'Multiple writers contending for database lock',
    solution: 'Enable WAL mode, implement retry logic, reduce concurrent writes.',
    severity: 'medium',
  },
];

// ============================================================
// DEEP SEARCH & REPAIR PROCEDURES
// ============================================================
export const DEEP_SEARCH_PROCEDURES = {
  description:
    'Deep search is Maya\u2019s most thorough diagnostic mode. It performs a comprehensive system-wide scan looking for hidden issues, misconfigurations, security vulnerabilities, and optimization opportunities.',
  procedures: [
    {
      name: 'Full System Health Audit',
      steps: [
        'Check all disk SMART data and health status',
        'Verify all file system integrity',
        'Check for filesystem errors in dmesg/journalctl',
        'Audit all running processes for anomalies',
        'Verify all Docker containers match expected state',
        'Check all network interfaces and routing',
        'Verify DNS resolution from host and containers',
        'Check system time synchronization (NTP)',
        'Audit file permissions on critical system files',
        'Check for pending security updates',
      ],
    },
    {
      name: 'Security Audit',
      steps: [
        'Check for open ports that should be closed',
        'Audit SSH configuration for best practices',
        'Check for world-readable sensitive files',
        'Review firewall rules',
        'Check for unauthorized user accounts',
        'Verify Docker socket permissions',
        'Check container privilege levels (avoid --privileged)',
        'Audit container network exposure',
        'Check for containers running as root unnecessarily',
        'Review recent authentication logs for suspicious activity',
      ],
    },
    {
      name: 'Performance Baseline',
      steps: [
        'Capture comprehensive system metrics snapshot',
        'Benchmark disk I/O (sequential and random)',
        'Measure network throughput',
        'Profile container startup times',
        'Check system entropy pool',
        'Measure DNS resolution times',
        'Check for kernel warnings or errors',
        'Compare current performance against historical baseline',
      ],
    },
    {
      name: 'Storage Integrity Scan',
      steps: [
        'Check all mounted filesystems for errors',
        'Verify Docker volume integrity',
        'Check for orphaned Docker volumes',
        'Scan for large files (>1GB) that may be unexpected',
        'Check for duplicate files across all drives',
        'Verify backup integrity if backups are configured',
        'Check inode usage (can run out before disk space)',
        'Audit file change timestamps for unexpected modifications',
      ],
    },
  ],
};

// ============================================================
// TYPE DEFINITIONS
// ============================================================
export interface MayaRule {
  id: string;
  category: string;
  rule: string;
  details: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface WatchItem {
  id: string;
  component: string;
  metric: string;
  warningThreshold: number;
  criticalThreshold: number;
  sustainedDuration: number; // seconds, 0 = immediate
  description: string;
  action: string;
}

export interface DiagnosticProcedure {
  id: string;
  name: string;
  trigger: string;
  steps: string[];
}

export interface RepairProcedure {
  id: string;
  name: string;
  issue: string;
  autoApproved: boolean;
  maxAutoRetries?: number;
  steps: string[];
  rollback: string;
}

export interface OptimizationProcedure {
  id: string;
  name: string;
  description: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  steps: string[];
}

export interface KnownPattern {
  id: string;
  name: string;
  symptoms: string[];
  rootCause: string;
  solution: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ============================================================
// EXPORT ALL
// ============================================================
export const MAYA_KNOWLEDGE_BASE = {
  overview: PLATFORM_OVERVIEW,
  dos: DOS,
  donts: DONTS,
  watchlist: WATCHLIST,
  diagnostics: DIAGNOSTIC_PROCEDURES,
  repairs: REPAIR_PROCEDURES,
  optimizations: OPTIMIZATION_PROCEDURES,
  knownPatterns: KNOWN_PATTERNS,
  deepSearch: DEEP_SEARCH_PROCEDURES,
};

export default MAYA_KNOWLEDGE_BASE;
