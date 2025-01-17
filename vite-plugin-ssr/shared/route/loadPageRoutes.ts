import type { PageFile } from '../getPageFiles'
import { isErrorPageId } from './error-page'
import { assert, assertUsage, hasProp, slice } from './utils'
import type { OnBeforeRouteHook } from './callOnBeforeRouteHook'
import { FilesystemRoot, deduceRouteStringFromFilesystemPath } from './deduceRouteStringFromFilesystemPath'
import { isCallable } from '../utils'
import type { PageConfig } from '../page-configs/PageConfig'

export { loadPageRoutes }
export { findPageRouteFile }
export type { PageRoutes }
export type { RouteType }

type PageRoute = {
  pageId: string
  comesFromV1PageConfig: boolean
} & ( // TODO: rename pageRouteFilePath to routeSrc (since pageRouteFilePath can be configSrc)
  | { routeString: string; pageRouteFilePath: null; routeType: 'FILESYSTEM'; routeFilesystemDefinedBy: string }
  | { routeString: string; pageRouteFilePath: string; routeType: 'STRING' }
  | { routeFunction: Function; pageRouteFilePath: string; allowAsync: boolean; routeType: 'FUNCTION' }
)
type PageRoutes = PageRoute[]
type RouteType = 'STRING' | 'FUNCTION' | 'FILESYSTEM'

async function loadPageRoutes(
  pageFilesAll: PageFile[],
  pageConfigs: PageConfig[],
  allPageIds: string[]
): Promise<{ pageRoutes: PageRoutes; onBeforeRouteHook: null | OnBeforeRouteHook }> {
  await Promise.all(pageFilesAll.filter((p) => p.fileType === '.page.route').map((p) => p.loadFile?.()))
  const { onBeforeRouteHook, filesystemRoots } = getGlobalHooks(pageFilesAll, pageConfigs)
  const pageRoutes = getPageRoutes(filesystemRoots, pageFilesAll, pageConfigs, allPageIds)
  return { pageRoutes, onBeforeRouteHook }
}

function getPageRoutes(
  filesystemRoots: FilesystemRoot[],
  pageFilesAll: PageFile[],
  pageConfigs: PageConfig[],
  allPageIds: string[]
): PageRoutes {
  const pageRoutes: PageRoutes = []

  let pageIds = [...allPageIds]

  // VPS 1.0
  if (pageConfigs.length > 0) {
    const comesFromV1PageConfig = true
    pageConfigs
      .filter((p) => !p.isErrorPage)
      .forEach((pageConfig) => {
        const pageId = pageConfig.pageId2
        pageIds = removePageId(pageIds, pageId)

        let pageRoute: null | PageRoute = null
        {
          const routeConfig = pageConfig.configSources.route
          if (routeConfig) {
            assert('configValue' in routeConfig) // Route files are eagerly loaded
            const route = routeConfig.configValue
            const pageRouteFilePath = routeConfig.configSrc
            assert(pageRouteFilePath)
            if (typeof route === 'string') {
              pageRoute = { pageId, comesFromV1PageConfig, routeString: route, pageRouteFilePath, routeType: 'STRING' }
            } else {
              assert(isCallable(route))
              let allowAsync = false
              const allowSyncConfig = pageConfig.configSources.iKnowThePerformanceRisksOfAsyncRouteFunctions
              if (allowSyncConfig) {
                assert(!('codeFilePath' in allowSyncConfig)) // TODO: improve this?
                const val = allowSyncConfig.configValue
                assert(typeof val === 'boolean') // TODO: assertUsage()
                allowAsync = val
              }
              pageRoute = {
                pageId,
                comesFromV1PageConfig,
                routeFunction: route,
                pageRouteFilePath,
                routeType: 'FUNCTION',
                allowAsync
              }
            }
          }
        }

        if (!pageRoute) {
          const { routeFilesystem, routeFilesystemDefinedBy } = pageConfig
          assert(routeFilesystem)
          assert(routeFilesystem.startsWith('/'))
          assert(routeFilesystemDefinedBy)
          pageRoute = {
            pageId,
            routeFilesystemDefinedBy,
            comesFromV1PageConfig,
            routeString: routeFilesystem,
            pageRouteFilePath: null,
            routeType: 'FILESYSTEM'
          }
        }

        assert(pageRoute)
        pageRoutes.push(pageRoute)
      })
  } else {
    // VPS 0.4
    const comesFromV1PageConfig = false
    pageIds
      .filter((pageId) => !isErrorPageId(pageId, false))
      .forEach((pageId) => {
        const pageRouteFile = findPageRouteFile(pageId, pageFilesAll)
        if (!pageRouteFile) {
          const routeString = deduceRouteStringFromFilesystemPath(pageId, filesystemRoots)
          assert(routeString.startsWith('/'))
          assert(!routeString.endsWith('/') || routeString === '/')
          pageRoutes.push({
            pageId,
            comesFromV1PageConfig,
            routeString,
            pageRouteFilePath: null,
            routeFilesystemDefinedBy: `${pageId}.page.*`,
            routeType: 'FILESYSTEM'
          })
        } else {
          const { filePath, fileExports } = pageRouteFile
          assert(fileExports)
          assertUsage('default' in fileExports, `${filePath} should have a default export.`)
          if (hasProp(fileExports, 'default', 'string')) {
            const routeString = fileExports.default
            assertUsage(
              routeString.startsWith('/'),
              `A Route String should start with a leading \`/\` but \`${filePath}\` has \`export default '${routeString}'\`. Make sure to \`export default '/${routeString}'\` instead.`
            )
            pageRoutes.push({
              pageId,
              comesFromV1PageConfig,
              routeString,
              pageRouteFilePath: filePath,
              routeType: 'STRING'
            })
            return
          }
          if (hasProp(fileExports, 'default', 'function')) {
            const routeFunction = fileExports.default
            let allowAsync = false
            const allowKey = 'iKnowThePerformanceRisksOfAsyncRouteFunctions'
            if (allowKey in fileExports) {
              assertUsage(
                hasProp(fileExports, allowKey, 'boolean'),
                `The export \`${allowKey}\` of ${filePath} should be a boolean.`
              )
              allowAsync = fileExports[allowKey]
            }
            pageRoutes.push({
              pageId,
              comesFromV1PageConfig,
              routeFunction,
              pageRouteFilePath: filePath,
              allowAsync,
              routeType: 'FUNCTION'
            })
            return
          }
          assertUsage(false, `The default export of ${filePath} should be a string or a function.`)
        }
      })
  }

  return pageRoutes
}

function getGlobalHooks(
  pageFilesAll: PageFile[],
  pageConfigs: PageConfig[]
): {
  onBeforeRouteHook: null | OnBeforeRouteHook
  filesystemRoots: FilesystemRoot[]
} {
  let onBeforeRouteHook: null | OnBeforeRouteHook = null
  const filesystemRoots: FilesystemRoot[] = []
  pageFilesAll
    .filter((p) => p.fileType === '.page.route' && p.isDefaultPageFile)
    .forEach(({ filePath, fileExports }) => {
      assert(fileExports)
      if ('onBeforeRoute' in fileExports) {
        assertUsage(
          hasProp(fileExports, 'onBeforeRoute', 'function'),
          `\`export { onBeforeRoute }\` of ${filePath} should be a function.`
        )
        const { onBeforeRoute } = fileExports
        onBeforeRouteHook = { hookSrc: `${filePath} > \`export { onBeforeRoute }\``, onBeforeRoute }
      }
      if ('filesystemRoutingRoot' in fileExports) {
        assertUsage(
          hasProp(fileExports, 'filesystemRoutingRoot', 'string'),
          `\`export { filesystemRoutingRoot }\` of ${filePath} should be a string.`
        )
        assertUsage(
          hasProp(fileExports, 'filesystemRoutingRoot', 'string'),
          `\`export { filesystemRoutingRoot }\` of ${filePath} is \`'${fileExports.filesystemRoutingRoot}'\` but it should start with a leading slash \`/\`.`
        )
        filesystemRoots.push({
          filesystemRoot: dirname(filePath),
          routeRoot: fileExports.filesystemRoutingRoot
        })
      }
    })

  /* TODO: define onBeforeRoute hook on globalConfig instead of pageConfigs
  pageConfigs.forEach((pageConfig) => {
    if (pageConfig.onBeforeRoute) {
      for (const pageConfigFile of pageConfig.pageConfigFiles) {
        const onBeforeRoute = pageConfigFile.pageConfigValues.onBeforeRoute
        if (onBeforeRoute) {
          const filePath = pageConfigFile.pageConfigFilePath
          assertUsage(
            isCallable(onBeforeRoute),
            `The hook onBeforeRoute() defined by ${filePath} should be a function.` // TODO: move assertUsage() to a central place containing all assertUsage()?
          )
          assert(onBeforeRoute === pageConfig.onBeforeRoute) // pageConfig.pageConfigFiles should have the right order
          onBeforeRouteHook = { filePath, onBeforeRoute }
          break
        }
      }
    }
  })
  */

  return { onBeforeRouteHook, filesystemRoots }
}

function findPageRouteFile(pageId: string, pageFilesAll: PageFile[]) {
  return pageFilesAll.find((p) => p.pageId === pageId && p.fileType === '.page.route')
}

function dirname(filePath: string): string {
  assert(filePath.startsWith('/'))
  assert(!filePath.endsWith('/'))
  const paths = filePath.split('/')
  const dirPath = slice(paths, 0, -1).join('/') || '/'
  assert(dirPath.startsWith('/'))
  assert(!dirPath.endsWith('/') || dirPath === '/')
  return dirPath
}

function removePageId(pageIds: string[], pageId: string): string[] {
  const { length } = pageIds
  pageIds = pageIds.filter((id) => id !== pageId)
  assert(pageIds.length === length - 1)
  return pageIds
}
