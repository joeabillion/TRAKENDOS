import Docker, { Container } from 'dockerode';
import mysql from 'mysql2/promise';
import { EventLogger } from './eventLogger';
import { DockerService } from './dockerService';

// Type for connection
type Connection = mysql.Connection;

export interface DatabaseInfo {
  name: string;
  tables: number;
  size: string;
}

export interface TableInfo {
  name: string;
  engine: string;
  rows: number;
  avgRowLength: number;
  dataLength: number;
  indexLength: number;
  dataFree: number;
  autoIncrement?: number;
  createTime: string;
  collation?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default?: string;
  extra: string;
}

export interface UserInfo {
  user: string;
  host: string;
}

export interface ProcessInfo {
  id: number;
  user: string;
  host: string;
  db: string;
  command: string;
  time: number;
  state: string;
  info: string;
}

export interface ServerStatus {
  containerRunning: boolean;
  connections: number;
  threads: number;
  questions: number;
  uptime: number;
  slowQueries: number;
  bytesSent: number;
  bytesReceived: number;
  bufferPoolSize: number;
  bufferPoolUsed: number;
}

export class MysqlService {
  private docker: Docker;
  private logger: EventLogger;
  private dockerService: DockerService;
  private connection: Connection | null = null;
  private containerName: string = 'trakend-mariadb';
  private imageName: string = 'mariadb:11';
  private rootPassword: string = 'trakend_db_root';
  private containerPort: number = 3306;
  private hostPort: number = 3306;

  constructor(socketPath: string, logger: EventLogger, dockerService: DockerService, rootPassword?: string) {
    this.docker = new Docker({ socketPath });
    this.logger = logger;
    this.dockerService = dockerService;
    if (rootPassword) {
      this.rootPassword = rootPassword;
    }
  }

  setRootPassword(password: string): void {
    this.rootPassword = password;
  }

  async ensureMariaDBRunning(): Promise<void> {
    try {
      const container = await this.getContainer();
      if (!container) {
        await this.deployMariaDB();
      } else {
        const data = await container.inspect();
        if (!data.State.Running) {
          await container.start();
          this.logger.info('MYSQL', 'Started existing MariaDB container');
          // Wait for MariaDB to be ready
          await this.waitForMariaDB();
        }
      }
    } catch (error) {
      this.logger.error('MYSQL', `Failed to ensure MariaDB is running: ${error}`);
      throw error;
    }
  }

  private async getContainer(): Promise<Container | null> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const container = containers.find((c) => c.Names.includes(`/${this.containerName}`));
      return container ? this.docker.getContainer(container.Id) : null;
    } catch (error) {
      this.logger.error('MYSQL', `Failed to find container: ${error}`);
      return null;
    }
  }

  private async deployMariaDB(): Promise<void> {
    try {
      this.logger.info('MYSQL', 'Deploying MariaDB container...');

      // Pull image if not exists
      try {
        await this.dockerService.pullImage(this.imageName);
      } catch {
        // Image might already exist
      }

      // Create and start container
      const container = await this.docker.createContainer({
        Image: this.imageName,
        name: this.containerName,
        Env: [`MARIADB_ROOT_PASSWORD=${this.rootPassword}`],
        HostConfig: {
          PortBindings: {
            [`${this.containerPort}/tcp`]: [{ HostPort: `${this.hostPort}` }],
          },
          RestartPolicy: {
            Name: 'unless-stopped',
            MaximumRetryCount: 0,
          },
        },
        ExposedPorts: {
          [`${this.containerPort}/tcp`]: {},
        },
      });

      await container.start();
      this.logger.info('MYSQL', `MariaDB container deployed and started`);

      // Wait for MariaDB to be ready
      await this.waitForMariaDB();
    } catch (error) {
      this.logger.error('MYSQL', `Failed to deploy MariaDB: ${error}`);
      throw error;
    }
  }

  private async waitForMariaDB(maxAttempts: number = 30, delayMs: number = 1000): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.getConnection();
        this.logger.info('MYSQL', 'MariaDB is ready');
        return;
      } catch {
        if (i === maxAttempts - 1) {
          throw new Error('MariaDB failed to start within timeout');
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async getConnection(): Promise<Connection> {
    if (!this.connection) {
      this.connection = await mysql.createConnection({
        host: 'localhost',
        port: this.hostPort,
        user: 'root',
        password: this.rootPassword,
      });
    }
    return this.connection;
  }

  async closeConnection(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }

  async getStatus(): Promise<ServerStatus> {
    try {
      const container = await this.getContainer();
      let containerRunning = false;

      if (container) {
        const data = await container.inspect();
        containerRunning = data.State.Running;
      }

      if (!containerRunning) {
        return {
          containerRunning: false,
          connections: 0,
          threads: 0,
          questions: 0,
          uptime: 0,
          slowQueries: 0,
          bytesSent: 0,
          bytesReceived: 0,
          bufferPoolSize: 0,
          bufferPoolUsed: 0,
        };
      }

      const conn = await this.getConnection();
      const [[status]] = await conn.query('SHOW GLOBAL STATUS');
      const statusObj = status as Record<string, any>;

      return {
        containerRunning: true,
        connections: parseInt(statusObj.Threads_connected || '0'),
        threads: parseInt(statusObj.Threads_running || '0'),
        questions: parseInt(statusObj.Questions || '0'),
        uptime: parseInt(statusObj.Uptime || '0'),
        slowQueries: parseInt(statusObj.Slow_queries || '0'),
        bytesSent: parseInt(statusObj.Bytes_sent || '0'),
        bytesReceived: parseInt(statusObj.Bytes_received || '0'),
        bufferPoolSize: parseInt(statusObj.Innodb_buffer_pool_size || '0'),
        bufferPoolUsed: parseInt(statusObj.Innodb_buffer_pool_bytes_dirty || '0'),
      };
    } catch (error) {
      this.logger.error('MYSQL', `Failed to get status: ${error}`);
      throw error;
    }
  }

  async startContainer(): Promise<void> {
    try {
      const container = await this.getContainer();
      if (container) {
        const data = await container.inspect();
        if (!data.State.Running) {
          await container.start();
          this.logger.info('MYSQL', 'MariaDB container started');
          await this.waitForMariaDB();
        }
      }
    } catch (error) {
      this.logger.error('MYSQL', `Failed to start container: ${error}`);
      throw error;
    }
  }

  async stopContainer(): Promise<void> {
    try {
      this.closeConnection();
      const container = await this.getContainer();
      if (container) {
        await container.stop();
        this.logger.info('MYSQL', 'MariaDB container stopped');
      }
    } catch (error) {
      this.logger.error('MYSQL', `Failed to stop container: ${error}`);
      throw error;
    }
  }

  async restartContainer(): Promise<void> {
    try {
      this.closeConnection();
      const container = await this.getContainer();
      if (container) {
        await container.restart();
        this.logger.info('MYSQL', 'MariaDB container restarted');
        await this.waitForMariaDB();
      }
    } catch (error) {
      this.logger.error('MYSQL', `Failed to restart container: ${error}`);
      throw error;
    }
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();

      const [databases] = await conn.query(
        "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
      );

      const dbList: DatabaseInfo[] = [];

      for (const db of databases as Array<{ SCHEMA_NAME: string }>) {
        try {
          const [[info]] = await conn.query(`SELECT TABLE_SCHEMA, COUNT(*) as table_count, ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) as size_mb FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${db.SCHEMA_NAME}' GROUP BY TABLE_SCHEMA`);

          dbList.push({
            name: db.SCHEMA_NAME,
            tables: (info as any)?.table_count || 0,
            size: `${(info as any)?.size_mb || 0} MB`,
          });
        } catch {
          dbList.push({
            name: db.SCHEMA_NAME,
            tables: 0,
            size: '0 MB',
          });
        }
      }

      return dbList;
    } catch (error) {
      this.logger.error('MYSQL', `Failed to list databases: ${error}`);
      throw error;
    }
  }

  async createDatabase(name: string, charset: string = 'utf8mb4', collation: string = 'utf8mb4_unicode_ci'): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET ${charset} COLLATE ${collation}`);
      this.logger.info('MYSQL', `Database '${name}' created`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to create database: ${error}`);
      throw error;
    }
  }

  async dropDatabase(name: string): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`DROP DATABASE \`${name}\``);
      this.logger.info('MYSQL', `Database '${name}' dropped`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to drop database: ${error}`);
      throw error;
    }
  }

  async listTables(database: string): Promise<string[]> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      const [tables] = await conn.query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${database}'`);
      return (tables as Array<{ TABLE_NAME: string }>).map((t) => t.TABLE_NAME);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to list tables: ${error}`);
      throw error;
    }
  }

  async getTableSchema(database: string, table: string): Promise<{ columns: ColumnInfo[]; sampleData: any[] }> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();

      const [columns] = await conn.query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${database}' AND TABLE_NAME = '${table}'`);

      const columnList: ColumnInfo[] = (columns as any[]).map((col) => ({
        name: col.COLUMN_NAME,
        type: col.COLUMN_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        key: col.COLUMN_KEY || 'NONE',
        default: col.COLUMN_DEFAULT,
        extra: col.EXTRA || '',
      }));

      // Get sample data
      const [sampleData] = await conn.query(`SELECT * FROM \`${database}\`.\`${table}\` LIMIT 5`);

      return {
        columns: columnList,
        sampleData: (sampleData as any[]) || [],
      };
    } catch (error) {
      this.logger.error('MYSQL', `Failed to get table schema: ${error}`);
      throw error;
    }
  }

  async query(database: string, sql: string): Promise<any> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`USE \`${database}\``);
      const [result] = await conn.query(sql);
      return result;
    } catch (error) {
      this.logger.error('MYSQL', `Query failed: ${error}`);
      throw error;
    }
  }

  async listUsers(): Promise<UserInfo[]> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      const [users] = await conn.query("SELECT User, Host FROM mysql.user WHERE User NOT IN ('mysql', 'root', 'mariadb.sys')");
      return (users as any[]).map((u) => ({
        user: u.User,
        host: u.Host,
      }));
    } catch (error) {
      this.logger.error('MYSQL', `Failed to list users: ${error}`);
      throw error;
    }
  }

  async createUser(user: string, host: string, password: string): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`CREATE USER '${user}'@'${host}' IDENTIFIED BY '${password}'`);
      this.logger.info('MYSQL', `User '${user}'@'${host}' created`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to create user: ${error}`);
      throw error;
    }
  }

  async dropUser(user: string, host: string): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`DROP USER '${user}'@'${host}'`);
      this.logger.info('MYSQL', `User '${user}'@'${host}' dropped`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to drop user: ${error}`);
      throw error;
    }
  }

  async grantPrivileges(user: string, host: string, privileges: string, database: string = '*', table: string = '*'): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO '${user}'@'${host}'`);
      await conn.query('FLUSH PRIVILEGES');
      this.logger.info('MYSQL', `Privileges granted to '${user}'@'${host}'`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to grant privileges: ${error}`);
      throw error;
    }
  }

  async showGrants(user: string, host: string): Promise<string[]> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      const [grants] = await conn.query(`SHOW GRANTS FOR '${user}'@'${host}'`);
      return (grants as any[]).map((g) => Object.values(g)[0] as string);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to show grants: ${error}`);
      throw error;
    }
  }

  async getProcessList(): Promise<ProcessInfo[]> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      const [processes] = await conn.query('SHOW PROCESSLIST');
      return (processes as any[]).map((p) => ({
        id: p.Id,
        user: p.User,
        host: p.Host,
        db: p.db || '',
        command: p.Command,
        time: p.Time,
        state: p.State || '',
        info: p.Info || '',
      }));
    } catch (error) {
      this.logger.error('MYSQL', `Failed to get process list: ${error}`);
      throw error;
    }
  }

  async killQuery(processId: number): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();
      await conn.query(`KILL QUERY ${processId}`);
      this.logger.info('MYSQL', `Query ${processId} killed`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to kill query: ${error}`);
      throw error;
    }
  }

  async exportDatabase(database: string): Promise<string> {
    try {
      const container = await this.getContainer();
      if (!container) {
        throw new Error('MariaDB container not found');
      }

      // Execute mysqldump inside the container
      const exec = await container.exec({
        Cmd: ['mysqldump', '-u', 'root', `-p${this.rootPassword}`, '--single-transaction', database],
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await exec.start({ Detach: false });

      return new Promise((resolve, reject) => {
        let output = '';
        let error = '';

        stream.on('data', (chunk) => {
          output += chunk.toString();
        });

        stream.on('error', (err) => {
          error += err.toString();
          reject(err);
        });

        stream.on('end', () => {
          if (error) {
            reject(new Error(error));
          } else {
            resolve(output);
          }
        });
      });
    } catch (error) {
      this.logger.error('MYSQL', `Failed to export database: ${error}`);
      throw error;
    }
  }

  async importDatabase(database: string, sqlContent: string): Promise<void> {
    try {
      await this.ensureMariaDBRunning();
      const conn = await this.getConnection();

      // Split by semicolon and execute each statement
      const statements = sqlContent.split(';').filter((s) => s.trim());

      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await conn.query(statement);
          } catch (err) {
            this.logger.warn('MYSQL', `Statement skipped: ${err}`);
          }
        }
      }

      this.logger.info('MYSQL', `Database '${database}' imported successfully`);
    } catch (error) {
      this.logger.error('MYSQL', `Failed to import database: ${error}`);
      throw error;
    }
  }
}
