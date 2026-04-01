export interface EnvVariable {
  name: string;
  default: string;
  description: string;
}

export interface VolumeMount {
  containerPath: string;
  hostPath: string;
  readOnly?: boolean;
}

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol?: string;
}

export interface ResourceLimits {
  cpuLimits?: string;
  cpuReservation?: string;
  memoryLimits?: string;
  memoryReservation?: string;
}

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string;
  dockerImage: string;
  dockerTag: string;
  ports: PortMapping[];
  environment: EnvVariable[];
  volumes: VolumeMount[];
  privileged?: boolean;
  capabilities?: string[];
  resourceLimits?: ResourceLimits;
  setupNotes: string;
}

export class AppTemplatesService {
  private templates: AppTemplate[] = [
    // Media Apps
    {
      id: 'plex',
      name: 'Plex Media Server',
      description: 'Stream movies, shows, music, and photos to your devices with Plex',
      category: 'Media',
      iconUrl: 'https://www.plex.tv/favicon.ico',
      dockerImage: 'plexinc/pms-docker',
      dockerTag: 'latest',
      ports: [
        { containerPort: 32400, hostPort: 32400, protocol: 'tcp' },
      ],
      environment: [
        { name: 'PUID', default: '1000', description: 'User ID' },
        { name: 'PGID', default: '1000', description: 'Group ID' },
        { name: 'VERSION', default: 'latest', description: 'Version to install' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/plex/config' },
        { containerPath: '/tv', hostPath: '/mnt/trakend/media/tv' },
        { containerPath: '/movies', hostPath: '/mnt/trakend/media/movies' },
      ],
      resourceLimits: {
        cpuReservation: '2',
        memoryReservation: '2GB',
      },
      setupNotes: 'Visit http://localhost:32400/web to configure. Claim your server with a Plex account.',
    },

    {
      id: 'jellyfin',
      name: 'Jellyfin',
      description: 'Free software media system - no subscriptions, no tracking',
      category: 'Media',
      iconUrl: 'https://jellyfin.org/favicon.ico',
      dockerImage: 'jellyfin/jellyfin',
      dockerTag: 'latest',
      ports: [
        { containerPort: 8096, hostPort: 8096, protocol: 'tcp' },
      ],
      environment: [
        { name: 'PUID', default: '1000', description: 'User ID' },
        { name: 'PGID', default: '1000', description: 'Group ID' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/jellyfin/config' },
        { containerPath: '/media', hostPath: '/mnt/trakend/media' },
      ],
      resourceLimits: {
        memoryReservation: '1.5GB',
      },
      setupNotes: 'Access Jellyfin at http://localhost:8096 and configure your media libraries.',
    },

    {
      id: 'sonarr',
      name: 'Sonarr',
      description: 'Smart PVR for newsgroup and BitTorrent users to download TV shows',
      category: 'Media',
      iconUrl: 'https://sonarr.tv/favicon.ico',
      dockerImage: 'linuxserver/sonarr',
      dockerTag: 'latest',
      ports: [
        { containerPort: 8989, hostPort: 8989, protocol: 'tcp' },
      ],
      environment: [
        { name: 'PUID', default: '1000', description: 'User ID' },
        { name: 'PGID', default: '1000', description: 'Group ID' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/sonarr/config' },
        { containerPath: '/tv', hostPath: '/mnt/trakend/media/tv' },
        { containerPath: '/downloads', hostPath: '/mnt/trakend/downloads' },
      ],
      setupNotes: 'Access Sonarr at http://localhost:8989 and configure download clients.',
    },

    {
      id: 'radarr',
      name: 'Radarr',
      description: 'Movie collection manager for Usenet and BitTorrent users',
      category: 'Media',
      iconUrl: 'https://radarr.video/favicon.ico',
      dockerImage: 'linuxserver/radarr',
      dockerTag: 'latest',
      ports: [
        { containerPort: 7878, hostPort: 7878, protocol: 'tcp' },
      ],
      environment: [
        { name: 'PUID', default: '1000', description: 'User ID' },
        { name: 'PGID', default: '1000', description: 'Group ID' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/radarr/config' },
        { containerPath: '/movies', hostPath: '/mnt/trakend/media/movies' },
        { containerPath: '/downloads', hostPath: '/mnt/trakend/downloads' },
      ],
      setupNotes: 'Access Radarr at http://localhost:7878 and set up movie management.',
    },

    {
      id: 'qbittorrent',
      name: 'qBittorrent',
      description: 'Open-source BitTorrent client and search engine',
      category: 'Media',
      iconUrl: 'https://www.qbittorrent.org/favicon.ico',
      dockerImage: 'linuxserver/qbittorrent',
      dockerTag: 'latest',
      ports: [
        { containerPort: 8080, hostPort: 8080, protocol: 'tcp' },
        { containerPort: 6881, hostPort: 6881, protocol: 'tcp' },
        { containerPort: 6881, hostPort: 6881, protocol: 'udp' },
      ],
      environment: [
        { name: 'PUID', default: '1000', description: 'User ID' },
        { name: 'PGID', default: '1000', description: 'Group ID' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/qbittorrent/config' },
        { containerPath: '/downloads', hostPath: '/mnt/trakend/downloads' },
      ],
      setupNotes: 'Access qBittorrent at http://localhost:8080. Default login: admin/adminadmin',
    },

    {
      id: 'overseerr',
      name: 'Overseerr',
      description: 'Request management and media discovery tool for Plex/Jellyfin',
      category: 'Media',
      iconUrl: 'https://overseerr.dev/favicon.ico',
      dockerImage: 'sctx/overseerr',
      dockerTag: 'latest',
      ports: [
        { containerPort: 5055, hostPort: 5055, protocol: 'tcp' },
      ],
      environment: [
        { name: 'LOG_LEVEL', default: 'info', description: 'Logging level' },
      ],
      volumes: [
        { containerPath: '/app/config', hostPath: '/mnt/trakend/overseerr/config' },
      ],
      setupNotes: 'Access Overseerr at http://localhost:5055 and connect to your Plex/Jellyfin server.',
    },

    // Cloud Storage Apps
    {
      id: 'nextcloud',
      name: 'Nextcloud',
      description: 'Open-source file sync and cloud storage solution',
      category: 'Cloud',
      iconUrl: 'https://nextcloud.com/favicon.ico',
      dockerImage: 'nextcloud',
      dockerTag: 'latest',
      ports: [
        { containerPort: 80, hostPort: 8888, protocol: 'tcp' },
      ],
      environment: [
        { name: 'NEXTCLOUD_ADMIN_USER', default: 'admin', description: 'Admin username' },
        { name: 'NEXTCLOUD_ADMIN_PASSWORD', default: 'admin123', description: 'Admin password' },
      ],
      volumes: [
        { containerPath: '/var/www/html', hostPath: '/mnt/trakend/nextcloud/html' },
        { containerPath: '/var/www/html/data', hostPath: '/mnt/trakend/nextcloud/data' },
      ],
      resourceLimits: {
        memoryReservation: '1GB',
      },
      setupNotes: 'Access Nextcloud at http://localhost:8888. Configure trusted domains for production.',
    },

    {
      id: 'gitea',
      name: 'Gitea',
      description: 'Lightweight Git service with a web interface',
      category: 'Cloud',
      iconUrl: 'https://gitea.io/favicon.ico',
      dockerImage: 'gitea/gitea',
      dockerTag: 'latest',
      ports: [
        { containerPort: 3000, hostPort: 3000, protocol: 'tcp' },
        { containerPort: 222, hostPort: 222, protocol: 'tcp' },
      ],
      environment: [
        { name: 'USER_UID', default: '1000', description: 'User ID' },
        { name: 'USER_GID', default: '1000', description: 'Group ID' },
      ],
      volumes: [
        { containerPath: '/data', hostPath: '/mnt/trakend/gitea/data' },
      ],
      setupNotes: 'Access Gitea at http://localhost:3000 to set up your Git server.',
    },

    {
      id: 'vaultwarden',
      name: 'Vaultwarden',
      description: 'Unofficial Bitwarden-compatible password manager backend',
      category: 'Cloud',
      iconUrl: 'https://bitwarden.com/favicon.ico',
      dockerImage: 'vaultwarden/server',
      dockerTag: 'latest',
      ports: [
        { containerPort: 80, hostPort: 8000, protocol: 'tcp' },
      ],
      environment: [
        { name: 'DOMAIN', default: 'http://localhost:8000', description: 'Domain URL' },
        { name: 'SIGNUPS_ALLOWED', default: 'true', description: 'Allow new user signups' },
      ],
      volumes: [
        { containerPath: '/data', hostPath: '/mnt/trakend/vaultwarden/data' },
      ],
      setupNotes: 'Access Vaultwarden at http://localhost:8000. Install Bitwarden client extensions.',
    },

    // Network Apps
    {
      id: 'pihole',
      name: 'Pi-hole',
      description: 'Network-wide ad blocker and DHCP server',
      category: 'Network',
      iconUrl: 'https://pi-hole.net/favicon.ico',
      dockerImage: 'pihole/pihole',
      dockerTag: 'latest',
      ports: [
        { containerPort: 80, hostPort: 8081, protocol: 'tcp' },
        { containerPort: 53, hostPort: 53, protocol: 'tcp' },
        { containerPort: 53, hostPort: 53, protocol: 'udp' },
      ],
      environment: [
        { name: 'WEBPASSWORD', default: 'pi-hole', description: 'Web UI password' },
        { name: 'TZ', default: 'UTC', description: 'Timezone' },
      ],
      volumes: [
        { containerPath: '/etc/pihole', hostPath: '/mnt/trakend/pihole/etc' },
        { containerPath: '/etc/dnsmasq.d', hostPath: '/mnt/trakend/pihole/dnsmasq' },
      ],
      setupNotes: 'Access Pi-hole at http://localhost:8081/admin. Set your router DNS to this server.',
    },

    {
      id: 'npm',
      name: 'Nginx Proxy Manager',
      description: 'Reverse proxy with web UI for easy management',
      category: 'Network',
      iconUrl: 'https://nginxproxymanager.com/favicon.ico',
      dockerImage: 'jc21/nginx-proxy-manager',
      dockerTag: 'latest',
      ports: [
        { containerPort: 80, hostPort: 80, protocol: 'tcp' },
        { containerPort: 443, hostPort: 443, protocol: 'tcp' },
        { containerPort: 81, hostPort: 81, protocol: 'tcp' },
      ],
      environment: [],
      volumes: [
        { containerPath: '/data', hostPath: '/mnt/trakend/npm/data' },
        { containerPath: '/etc/letsencrypt', hostPath: '/mnt/trakend/npm/letsencrypt' },
      ],
      setupNotes: 'Access NPM at http://localhost:81. Default: admin@example.com / changeme',
    },

    {
      id: 'wireguard',
      name: 'WireGuard',
      description: 'Modern VPN protocol - fast, secure, and simple',
      category: 'Network',
      iconUrl: 'https://www.wireguard.com/img/favicon.ico',
      dockerImage: 'linuxserver/wireguard',
      dockerTag: 'latest',
      ports: [
        { containerPort: 51820, hostPort: 51820, protocol: 'udp' },
      ],
      environment: [
        { name: 'PUID', default: '1000', description: 'User ID' },
        { name: 'PGID', default: '1000', description: 'Group ID' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/wireguard/config' },
      ],
      privileged: true,
      setupNotes: 'WireGuard configuration files in /config. Use wg-easy for UI.',
    },

    {
      id: 'traefik',
      name: 'Traefik',
      description: 'Modern reverse proxy and load balancer',
      category: 'Network',
      iconUrl: 'https://doc.traefik.io/traefik/assets/img/traefik.icon.png',
      dockerImage: 'traefik',
      dockerTag: 'latest',
      ports: [
        { containerPort: 80, hostPort: 8080, protocol: 'tcp' },
        { containerPort: 443, hostPort: 8443, protocol: 'tcp' },
        { containerPort: 8080, hostPort: 8082, protocol: 'tcp' },
      ],
      environment: [],
      volumes: [
        { containerPath: '/etc/traefik', hostPath: '/mnt/trakend/traefik/config' },
      ],
      setupNotes: 'Access Traefik dashboard at http://localhost:8082. Configure providers.',
    },

    // Monitoring Apps
    {
      id: 'grafana',
      name: 'Grafana',
      description: 'Open-source visualization and analytics platform',
      category: 'Monitoring',
      iconUrl: 'https://grafana.com/favicon.ico',
      dockerImage: 'grafana/grafana',
      dockerTag: 'latest',
      ports: [
        { containerPort: 3000, hostPort: 3100, protocol: 'tcp' },
      ],
      environment: [
        { name: 'GF_SECURITY_ADMIN_PASSWORD', default: 'admin', description: 'Admin password' },
      ],
      volumes: [
        { containerPath: '/var/lib/grafana', hostPath: '/mnt/trakend/grafana/lib' },
      ],
      setupNotes: 'Access Grafana at http://localhost:3100. Default: admin/admin',
    },

    {
      id: 'prometheus',
      name: 'Prometheus',
      description: 'Monitoring and alerting system with time-series database',
      category: 'Monitoring',
      iconUrl: 'https://prometheus.io/favicon.ico',
      dockerImage: 'prom/prometheus',
      dockerTag: 'latest',
      ports: [
        { containerPort: 9090, hostPort: 9090, protocol: 'tcp' },
      ],
      environment: [],
      volumes: [
        { containerPath: '/etc/prometheus', hostPath: '/mnt/trakend/prometheus/config' },
        { containerPath: '/prometheus', hostPath: '/mnt/trakend/prometheus/data' },
      ],
      setupNotes: 'Access Prometheus at http://localhost:9090. Configure prometheus.yml.',
    },

    {
      id: 'uptime-kuma',
      name: 'Uptime Kuma',
      description: 'Self-hosted uptime monitoring tool',
      category: 'Monitoring',
      iconUrl: 'https://uptime.kuma.pet/favicon.ico',
      dockerImage: 'louislam/uptime-kuma',
      dockerTag: 'latest',
      ports: [
        { containerPort: 3001, hostPort: 3001, protocol: 'tcp' },
      ],
      environment: [],
      volumes: [
        { containerPath: '/app/data', hostPath: '/mnt/trakend/uptime-kuma/data' },
      ],
      setupNotes: 'Access Uptime Kuma at http://localhost:3001 and set up monitoring.',
    },

    {
      id: 'portainer',
      name: 'Portainer',
      description: 'Docker management UI with container orchestration',
      category: 'Monitoring',
      iconUrl: 'https://www.portainer.io/favicon.ico',
      dockerImage: 'portainer/portainer-ce',
      dockerTag: 'latest',
      ports: [
        { containerPort: 9000, hostPort: 9000, protocol: 'tcp' },
        { containerPort: 8000, hostPort: 8000, protocol: 'tcp' },
      ],
      environment: [],
      volumes: [
        { containerPath: '/data', hostPath: '/mnt/trakend/portainer/data' },
      ],
      setupNotes: 'Access Portainer at http://localhost:9000. Set up admin account.',
    },

    // Home Automation
    {
      id: 'homeassistant',
      name: 'Home Assistant',
      description: 'Open-source home automation platform',
      category: 'Home',
      iconUrl: 'https://www.home-assistant.io/favicon.ico',
      dockerImage: 'homeassistant/home-assistant',
      dockerTag: 'latest',
      ports: [
        { containerPort: 8123, hostPort: 8123, protocol: 'tcp' },
      ],
      environment: [
        { name: 'TZ', default: 'UTC', description: 'Timezone' },
      ],
      volumes: [
        { containerPath: '/config', hostPath: '/mnt/trakend/homeassistant/config' },
      ],
      privileged: true,
      setupNotes: 'Access Home Assistant at http://localhost:8123. Create account on first login.',
    },

    {
      id: 'nodered',
      name: 'Node-RED',
      description: 'Low-code programming for event-driven applications',
      category: 'Home',
      iconUrl: 'https://nodered.org/favicon.ico',
      dockerImage: 'nodered/node-red',
      dockerTag: 'latest',
      ports: [
        { containerPort: 1880, hostPort: 1880, protocol: 'tcp' },
      ],
      environment: [],
      volumes: [
        { containerPath: '/data', hostPath: '/mnt/trakend/nodered/data' },
      ],
      setupNotes: 'Access Node-RED at http://localhost:1880. Create flows for automation.',
    },

    // Development
    {
      id: 'code-server',
      name: 'VS Code Server',
      description: 'Run VS Code in your browser with code-server',
      category: 'Dev',
      iconUrl: 'https://code.visualstudio.com/favicon.ico',
      dockerImage: 'codercom/code-server',
      dockerTag: 'latest',
      ports: [
        { containerPort: 8443, hostPort: 8443, protocol: 'tcp' },
      ],
      environment: [
        { name: 'PASSWORD', default: 'changeme', description: 'Web UI password' },
      ],
      volumes: [
        { containerPath: '/home/coder/project', hostPath: '/mnt/trakend/code-server/project' },
      ],
      setupNotes: 'Access Code Server at https://localhost:8443. Change default password.',
    },

    {
      id: 'postgresql',
      name: 'PostgreSQL',
      description: 'Advanced open-source relational database',
      category: 'Dev',
      iconUrl: 'https://www.postgresql.org/favicon.ico',
      dockerImage: 'postgres',
      dockerTag: 'latest',
      ports: [
        { containerPort: 5432, hostPort: 5432, protocol: 'tcp' },
      ],
      environment: [
        { name: 'POSTGRES_PASSWORD', default: 'postgres', description: 'Root password' },
        { name: 'POSTGRES_USER', default: 'postgres', description: 'Root user' },
      ],
      volumes: [
        { containerPath: '/var/lib/postgresql/data', hostPath: '/mnt/trakend/postgresql/data' },
      ],
      setupNotes: 'PostgreSQL is ready at localhost:5432 with your configured credentials.',
    },
  ];

  getTemplates(category?: string): AppTemplate[] {
    if (!category) {
      return this.templates;
    }
    return this.templates.filter((t) => t.category === category);
  }

  getTemplateById(id: string): AppTemplate | undefined {
    return this.templates.find((t) => t.id === id);
  }

  getCategories(): string[] {
    const categories = new Set(this.templates.map((t) => t.category));
    return Array.from(categories).sort();
  }
}
