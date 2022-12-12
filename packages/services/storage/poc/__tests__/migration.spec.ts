import { createPool, sql, DatabasePool } from 'slonik';
import { readFileSync } from 'fs';
import { join } from 'path';

const migrationScript = readFileSync(
  join(__dirname, '../../migrations/actions/2022.12.12T11.03.41.registry-v2.sql'),
  'utf-8',
);

function migration(
  runner: (pool: DatabasePool) => Promise<() => Promise<void>>,
): () => Promise<void> {
  return async () => {
    const pool = await createPool('postgres://postgres:postgres@localhost:5432/poc');

    await pool.transaction(async t => {
      // clean up
      await t.query(sql`
        DROP TABLE IF EXISTS public.version_commit;
        DROP TABLE IF EXISTS public.versions;
        DROP TABLE IF EXISTS public.commits;
        DROP TABLE IF EXISTS public.schema_version_to_log;
        DROP TABLE IF EXISTS public.schema_versions;
        DROP TABLE IF EXISTS public.schema_log;
        DROP TABLE IF EXISTS public.targets;
        DROP TABLE IF EXISTS public.projects;
        DROP TYPE IF EXISTS schema_registry_action;
      `);

      // tables from `main` branch
      await t.query(sql`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

        -- a slice of the original table
        CREATE TABLE public.projects (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          name text NOT NULL,
          type text NOT NULL,
          created_at timestamp with time zone NOT NULL DEFAULT NOW()
        );
        -- a slice of the original table
        CREATE TABLE public.targets (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          name text NOT NULL,
          created_at timestamp with time zone NOT NULL DEFAULT NOW(),
          project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
        );
        CREATE TABLE public.commits (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          author text NOT NULL,
          created_at timestamp with time zone NOT NULL DEFAULT NOW(),
          service text,
          content text,
          metadata text,
          commit text NOT NULL,
          target_id uuid NOT NULL REFERENCES public.targets(id) ON DELETE CASCADE,
          project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
        );
        CREATE TABLE public.versions (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          created_at timestamp with time zone NOT NULL DEFAULT NOW(),
          valid boolean NOT NULL,
          base_schema text,
          target_id uuid NOT NULL REFERENCES public.targets(id) ON DELETE CASCADE,
          commit_id uuid NOT NULL REFERENCES public.commits(id) ON DELETE CASCADE
        );
        CREATE TABLE public.version_commit (
          version_id uuid NOT NULL REFERENCES public.versions(id) ON DELETE CASCADE,
          commit_id uuid NOT NULL REFERENCES public.commits(id) ON DELETE CASCADE,
          url text,
          PRIMARY KEY(version_id, commit_id)
        );
      `);
    });

    const after = await runner(pool);

    await pool.query({
      sql: migrationScript,
      type: 'SLONIK_TOKEN_SQL',
      values: [],
    });

    await after();
  };
}

test(
  'single projects',
  migration(async t => {
    // single
    const project = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('single-project', 'SINGLE')
        RETURNING *`,
    );
    const target = await t.one(
      sql`
        INSERT INTO public.targets
          (name, project_id)
        VALUES
          ('single-target', ${project.id})
        RETURNING *
      `,
    );

    const firstCommit = await t.one(
      sql`
        INSERT INTO public.commits
          (author, content, commit, target_id, project_id)
        VALUES
          ('single-author', 'single-sdl', 'single-init', ${target.id}, ${project.id})
        RETURNING *
      `,
    );

    const firstVersion = await t.one(
      sql`
        INSERT INTO public.versions
          (valid, target_id, commit_id)
        VALUES
          (false, ${target.id}, ${firstCommit.id})
        RETURNING *
      `,
    );
    await t.query(
      sql`
        INSERT INTO public.version_commit
          (version_id, commit_id)
        VALUES
          (${firstVersion.id}, ${firstCommit.id})
      `,
    );

    const secondCommit = await t.one(
      sql`
        INSERT INTO public.commits
          (author, content, commit, target_id, project_id)
        VALUES
          ('single-author', 'single-sdl', 'single-second', ${target.id}, ${project.id})
        RETURNING *
      `,
    );

    const secondVersion = await t.one(
      sql`
        INSERT INTO public.versions
          (valid, target_id, commit_id)
        VALUES
          (true, ${target.id}, ${secondCommit.id})
        RETURNING *
      `,
    );

    await t.query(
      sql`
        INSERT INTO public.version_commit
          (version_id, commit_id)
        VALUES
          (${secondVersion.id}, ${secondCommit.id})
      `,
    );

    return async () => {
      // Expect all commits to has PUSH action
      await expect(
        t.many(
          sql`
            SELECT action
            FROM public.schema_log
            WHERE project_id = ${project.id}
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
        },
        {
          action: 'PUSH',
        },
      ]);

      // Expect only the second version to be composable (just like it was before migration)
      await expect(
        t.many(
          sql`
            SELECT is_composable FROM public.schema_versions WHERE target_id = ${target.id}
          `,
        ),
      ).resolves.toEqual([
        {
          is_composable: false,
        },
        {
          is_composable: true,
        },
      ]);

      // All commits should not have service_name and service_url set (just like before the migration)
      await expect(
        t.one(
          sql`
            SELECT count(*) as total
            FROM public.schema_log
            WHERE 
              target_id = ${target.id}
              AND service_name is null 
              AND service_url is null
          `,
        ),
      ).resolves.toEqual({
        total: 2,
      });
    };
  }),
);

test(
  'custom projects',
  migration(async t => {
    const project = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('custom-project', 'CUSTOM')
        RETURNING *`,
    );
    const target = await t.one(
      sql`
        INSERT INTO public.targets
          (name, project_id)
        VALUES
          ('custom-target', ${project.id})
        RETURNING *
      `,
    );

    const firstCommit = await t.one(
      sql`
        INSERT INTO public.commits
          (author, content, commit, target_id, project_id)
        VALUES
          ('custom-author', 'custom-sdl', 'custom-init', ${target.id}, ${project.id})
        RETURNING *
      `,
    );

    const firstVersion = await t.one(
      sql`
        INSERT INTO public.versions
          (valid, target_id, commit_id)
        VALUES
          (false, ${target.id}, ${firstCommit.id})
        RETURNING *
      `,
    );
    await t.query(
      sql`
        INSERT INTO public.version_commit
          (version_id, commit_id)
        VALUES
          (${firstVersion.id}, ${firstCommit.id})
      `,
    );

    const secondCommit = await t.one(
      sql`
        INSERT INTO public.commits
          (author, content, commit, target_id, project_id)
        VALUES
          ('custom-author', 'custom-sdl', 'custom-second', ${target.id}, ${project.id})
        RETURNING *
      `,
    );

    const secondVersion = await t.one(
      sql`
        INSERT INTO public.versions
          (valid, target_id, commit_id)
        VALUES
          (true, ${target.id}, ${secondCommit.id})
        RETURNING *
      `,
    );

    await t.query(
      sql`
        INSERT INTO public.version_commit
          (version_id, commit_id)
        VALUES
          (${secondVersion.id}, ${secondCommit.id})
      `,
    );

    return async () => {
      // Expect all commits to has PUSH action
      await expect(
        t.many(
          sql`
            SELECT action
            FROM public.schema_log
            WHERE project_id = ${project.id}
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
        },
        {
          action: 'PUSH',
        },
      ]);

      // Expect only the second version to be composable (just like it was before migration)
      await expect(
        t.many(
          sql`
            SELECT is_composable FROM public.schema_versions WHERE target_id = ${target.id}
          `,
        ),
      ).resolves.toEqual([
        {
          is_composable: false,
        },
        {
          is_composable: true,
        },
      ]);

      // All commits should not have service_name and service_url set (just like before the migration)
      await expect(
        t.one(
          sql`
            SELECT count(*) as total
            FROM public.schema_log
            WHERE 
              target_id = ${target.id}
              AND service_name is null 
              AND service_url is null
          `,
        ),
      ).resolves.toEqual({
        total: 2,
      });
    };
  }),
);

test(
  'federation projects',
  migration(async t => {
    const project = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('fed-project', 'FEDERATION')
        RETURNING *
      `,
    );
    const target = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('fed-target', ${project.id})
      RETURNING *
    `);

    const otherTarget = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('fed-target-second', ${project.id})
      RETURNING *
    `);

    const firstCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('fed-author', 'fed-sdl-reviews-first', 'fed-init', 'reviews', ${target.id}, ${project.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const firstVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${target.id}, ${firstCommit.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${firstVersion.id}, ${firstCommit.id}, 'fed-reviews-url-init')
    `);

    const firstCommitOfOtherTarget = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('fed-author', 'fed-second-sdl-reviews-first', 'fed-init', 'reviews',  ${otherTarget.id}, ${project.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const firstVersionOfOtherTarget = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${otherTarget.id}, ${firstCommitOfOtherTarget.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${firstVersionOfOtherTarget.id}, ${firstCommitOfOtherTarget.id}, 'fed-second-reviews-url-init')
    `);

    const secondCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
      ('fed-author', 'fed-sdl-reviews-second', 'fed-second', 'reviews', ${target.id}, ${project.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    const secondVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${target.id}, ${secondCommit.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${secondVersion.id}, ${secondCommit.id}, 'fed-reviews-url-second')
    `);

    const thirdCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('fed-author', 'fed-sdl-products-first', 'fed-third', 'products', ${target.id}, ${project.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    const thirdVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${target.id}, ${thirdCommit.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit (version_id, commit_id, url)
      VALUES
        (${thirdVersion.id}, ${thirdCommit.id}, 'fed-products-url-init'),
        (${thirdVersion.id}, ${secondCommit.id}, 'fed-reviews-url-second')
    `);

    return async () => {
      // Expect only the commits from the first target in the same order as before migration
      // and with the same service_name and service_url, composability and with correct actions
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${target.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'fed-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'fed-sdl-reviews-first',
        },
        {
          action: 'PUSH',
          service_url: 'fed-reviews-url-second',
          service_name: 'reviews',
          is_composable: true,
          sdl: 'fed-sdl-reviews-second',
        },
        {
          action: 'PUSH',
          service_url: 'fed-products-url-init',
          service_name: 'products',
          is_composable: true,
          sdl: 'fed-sdl-products-first',
        },
      ]);

      // Expect the other target to has its own commits in the same order as before migration
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${otherTarget.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'fed-second-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'fed-second-sdl-reviews-first',
        },
      ]);
    };
  }),
);

test(
  'stitching projects',
  migration(async t => {
    const project = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('st-project', 'STITCHING')
        RETURNING *
      `,
    );
    const target = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('st-target', ${project.id})
      RETURNING *
    `);

    const otherTarget = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('st-target-second', ${project.id})
      RETURNING *
    `);

    const firstCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('st-author', 'st-sdl-reviews-first', 'st-init', 'reviews', ${target.id}, ${project.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const firstVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${target.id}, ${firstCommit.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${firstVersion.id}, ${firstCommit.id}, 'st-reviews-url-init')
    `);

    const firstCommitOfOtherTarget = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('st-author', 'st-second-sdl-reviews-first', 'st-init', 'reviews',  ${otherTarget.id}, ${project.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const firstVersionOfOtherTarget = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${otherTarget.id}, ${firstCommitOfOtherTarget.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${firstVersionOfOtherTarget.id}, ${firstCommitOfOtherTarget.id}, 'st-second-reviews-url-init')
    `);

    const secondCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
      ('st-author', 'st-sdl-reviews-second', 'st-second', 'reviews', ${target.id}, ${project.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    const secondVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${target.id}, ${secondCommit.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${secondVersion.id}, ${secondCommit.id}, 'st-reviews-url-second')
    `);

    const thirdCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('st-author', 'st-sdl-products-first', 'st-third', 'products', ${target.id}, ${project.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    const thirdVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${target.id}, ${thirdCommit.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit (version_id, commit_id, url)
      VALUES
        (${thirdVersion.id}, ${thirdCommit.id}, 'st-products-url-init'),
        (${thirdVersion.id}, ${secondCommit.id}, 'st-reviews-url-second')
    `);

    return async () => {
      // Expect only the commits from the first target in the same order as before migration
      // and with the same service_name and service_url, composability and with correct actions
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${target.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'st-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'st-sdl-reviews-first',
        },
        {
          action: 'PUSH',
          service_url: 'st-reviews-url-second',
          service_name: 'reviews',
          is_composable: true,
          sdl: 'st-sdl-reviews-second',
        },
        {
          action: 'PUSH',
          service_url: 'st-products-url-init',
          service_name: 'products',
          is_composable: true,
          sdl: 'st-sdl-products-first',
        },
      ]);

      // Expect the other target to has its own commits in the same order as before migration
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${otherTarget.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'st-second-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'st-second-sdl-reviews-first',
        },
      ]);
    };
  }),
);

test(
  'federation and single projects together',
  migration(async t => {
    // single
    const singleProject = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('single-project', 'SINGLE')
        RETURNING *`,
    );
    const singleTarget = await t.one(
      sql`
        INSERT INTO public.targets
          (name, project_id)
        VALUES
          ('single-target', ${singleProject.id})
        RETURNING *
      `,
    );

    const singleFirstCommit = await t.one(
      sql`
        INSERT INTO public.commits
          (author, content, commit, target_id, project_id)
        VALUES
          ('single-author', 'single-sdl', 'single-init', ${singleTarget.id}, ${singleProject.id})
        RETURNING *
      `,
    );

    const singleFirstVersion = await t.one(
      sql`
        INSERT INTO public.versions
          (valid, target_id, commit_id)
        VALUES
          (false, ${singleTarget.id}, ${singleFirstCommit.id})
        RETURNING *
      `,
    );
    await t.query(
      sql`
        INSERT INTO public.version_commit
          (version_id, commit_id)
        VALUES
          (${singleFirstVersion.id}, ${singleFirstCommit.id})
      `,
    );

    const singleSecondCommit = await t.one(
      sql`
        INSERT INTO public.commits
          (author, content, commit, target_id, project_id)
        VALUES
          ('single-author', 'single-sdl', 'single-second', ${singleTarget.id}, ${singleProject.id})
        RETURNING *
      `,
    );

    const singleSecondVersion = await t.one(
      sql`
        INSERT INTO public.versions
          (valid, target_id, commit_id)
        VALUES
          (true, ${singleTarget.id}, ${singleSecondCommit.id})
        RETURNING *
      `,
    );

    await t.query(
      sql`
        INSERT INTO public.version_commit
          (version_id, commit_id)
        VALUES
          (${singleSecondVersion.id}, ${singleSecondCommit.id})
      `,
    );

    const fedProject = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('fed-project', 'FEDERATION')
        RETURNING *
      `,
    );
    const fedTarget = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('fed-target', ${fedProject.id})
      RETURNING *
    `);

    const otherTarget = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('fed-target-second', ${fedProject.id})
      RETURNING *
    `);

    const fedFirstCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('fed-author', 'fed-sdl-reviews-first', 'fed-init', 'reviews', ${fedTarget.id}, ${fedProject.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const fedFirstVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${fedTarget.id}, ${fedFirstCommit.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${fedFirstVersion.id}, ${fedFirstCommit.id}, 'fed-reviews-url-init')
    `);

    const firstCommitOfOtherTarget = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('fed-author', 'fed-second-sdl-reviews-first', 'fed-init', 'reviews',  ${otherTarget.id}, ${fedProject.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const firstVersionOfOtherTarget = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${otherTarget.id}, ${firstCommitOfOtherTarget.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${firstVersionOfOtherTarget.id}, ${firstCommitOfOtherTarget.id}, 'fed-second-reviews-url-init')
    `);

    const fedSecondCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
      ('fed-author', 'fed-sdl-reviews-second', 'fed-second', 'reviews', ${fedTarget.id}, ${fedProject.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    const fedSecondVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${fedTarget.id}, ${fedSecondCommit.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${fedSecondVersion.id}, ${fedSecondCommit.id}, 'fed-reviews-url-second')
    `);

    const fedThirdCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('fed-author', 'fed-sdl-products-first', 'fed-third', 'products', ${fedTarget.id}, ${fedProject.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    const fedThirdVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${fedTarget.id}, ${fedThirdCommit.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit (version_id, commit_id, url)
      VALUES
        (${fedThirdVersion.id}, ${fedThirdCommit.id}, 'fed-products-url-init'),
        (${fedThirdVersion.id}, ${fedSecondCommit.id}, 'fed-reviews-url-second')
    `);

    // Stitching

    const stProject = await t.one(
      sql`
        INSERT INTO public.projects
          (name, type)
        VALUES
          ('st-project', 'STITCHING')
        RETURNING *
      `,
    );
    const stTarget = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('st-target', ${stProject.id})
      RETURNING *
    `);

    const stOtherTarget = await t.one(sql`
      INSERT INTO public.targets
        (name, project_id)
      VALUES
        ('st-target-second', ${stProject.id})
      RETURNING *
    `);

    const stFirstCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('st-author', 'st-sdl-reviews-first', 'st-init', 'reviews', ${stTarget.id}, ${stProject.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const stFirstVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${stTarget.id}, ${stFirstCommit.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${stFirstVersion.id}, ${stFirstCommit.id}, 'st-reviews-url-init')
    `);

    const stFirstCommitOfOtherTarget = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('st-author', 'st-second-sdl-reviews-first', 'st-init', 'reviews',  ${stOtherTarget.id}, ${stProject.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    const stFirstVersionOfOtherTarget = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (false, ${stOtherTarget.id}, ${stFirstCommitOfOtherTarget.id}, NOW() + INTERVAL '1 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${stFirstVersionOfOtherTarget.id}, ${stFirstCommitOfOtherTarget.id}, 'st-second-reviews-url-init')
    `);

    const stSecondCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
      ('st-author', 'st-sdl-reviews-second', 'st-second', 'reviews', ${stTarget.id}, ${stProject.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    const stSecondVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${stTarget.id}, ${stSecondCommit.id}, NOW() + INTERVAL '2 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit
        (version_id, commit_id, url)
      VALUES
        (${stSecondVersion.id}, ${stSecondCommit.id}, 'st-reviews-url-second')
    `);

    const stThirdCommit = await t.one(sql`
      INSERT INTO public.commits
        (author, content, commit, service, target_id, project_id, created_at)
      VALUES
        ('st-author', 'st-sdl-products-first', 'st-third', 'products', ${stTarget.id}, ${stProject.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    const stThirdVersion = await t.one(sql`
      INSERT INTO public.versions
        (valid, target_id, commit_id, created_at)
      VALUES
        (true, ${stTarget.id}, ${stThirdCommit.id}, NOW() + INTERVAL '3 DAY')
      RETURNING *
    `);

    await t.query(sql`
      INSERT INTO public.version_commit (version_id, commit_id, url)
      VALUES
        (${stThirdVersion.id}, ${stThirdCommit.id}, 'st-products-url-init'),
        (${stThirdVersion.id}, ${stSecondCommit.id}, 'st-reviews-url-second')
    `);

    return async () => {
      // Federation

      // Expect only the commits from the first target in the same order as before migration
      // and with the same service_name and service_url, composability and with correct actions
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${fedTarget.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'fed-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'fed-sdl-reviews-first',
        },
        {
          action: 'PUSH',
          service_url: 'fed-reviews-url-second',
          service_name: 'reviews',
          is_composable: true,
          sdl: 'fed-sdl-reviews-second',
        },
        {
          action: 'PUSH',
          service_url: 'fed-products-url-init',
          service_name: 'products',
          is_composable: true,
          sdl: 'fed-sdl-products-first',
        },
      ]);

      // Expect the other target to has its own commits in the same order as before migration
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${otherTarget.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'fed-second-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'fed-second-sdl-reviews-first',
        },
      ]);

      // Single

      // Expect all commits to has PUSH action
      await expect(
        t.many(
          sql`
            SELECT action
            FROM public.schema_log
            WHERE project_id = ${singleProject.id}
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
        },
        {
          action: 'PUSH',
        },
      ]);

      // Expect only the second version to be composable (just like it was before migration)
      await expect(
        t.many(
          sql`
            SELECT is_composable FROM public.schema_versions WHERE target_id = ${singleTarget.id}
          `,
        ),
      ).resolves.toEqual([
        {
          is_composable: false,
        },
        {
          is_composable: true,
        },
      ]);

      // All commits should not have service_name and service_url set (just like before the migration)
      await expect(
        t.one(
          sql`
            SELECT count(*) as total
            FROM public.schema_log
            WHERE 
              target_id = ${singleTarget.id}
              AND service_name is null 
              AND service_url is null
          `,
        ),
      ).resolves.toEqual({
        total: 2,
      });

      // Stitching

      // Expect only the commits from the first target in the same order as before migration
      // and with the same service_name and service_url, composability and with correct actions
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${stTarget.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'st-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'st-sdl-reviews-first',
        },
        {
          action: 'PUSH',
          service_url: 'st-reviews-url-second',
          service_name: 'reviews',
          is_composable: true,
          sdl: 'st-sdl-reviews-second',
        },
        {
          action: 'PUSH',
          service_url: 'st-products-url-init',
          service_name: 'products',
          is_composable: true,
          sdl: 'st-sdl-products-first',
        },
      ]);

      // Expect the other target to has its own commits in the same order as before migration
      await expect(
        t.many(
          sql`
            SELECT a.action, a.service_url, a.service_name, v.is_composable, a.sdl
            FROM public.schema_versions v
            LEFT JOIN public.schema_log a ON a.id = v.action_id
            WHERE a.target_id = ${stOtherTarget.id} ORDER BY v.created_at ASC
          `,
        ),
      ).resolves.toEqual([
        {
          action: 'PUSH',
          service_url: 'st-second-reviews-url-init',
          service_name: 'reviews',
          is_composable: false,
          sdl: 'st-second-sdl-reviews-first',
        },
      ]);
    };
  }),
);
