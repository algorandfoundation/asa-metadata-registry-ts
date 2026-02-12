import { Config } from '@algorandfoundation/algokit-utils'
import { warningConsoleLogger } from '@algorandfoundation/algokit-utils/types/logging'

Config.configure({ debug: true, populateAppCallResources: true, logger: warningConsoleLogger })
