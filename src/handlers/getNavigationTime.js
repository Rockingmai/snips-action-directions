const { i18nFactory, directionsHttpFactory } = require('../factories')
const { logger, translation, directions, slot, tts } = require('../utils')
const commonHandler = require('./common')
const {
    INTENT_FILTER_PROBABILITY_THRESHOLD
} = require('../constants')

module.exports = async function (msg, flow, knownSlots = { depth: 2 }) {
    const i18n = i18nFactory.get()

    logger.info('GetNavigationTime')
    
    // Extracting slots
    const {
        locationFrom,
        locationTo,
        travelMode
    } = await commonHandler(msg, knownSlots)

    // At least one required slot is missing
    if (slot.missing(locationFrom) || slot.missing(locationTo)) {
        if (knownSlots.depth === 0) {
            throw new Error('slotsNotRecognized')
        }

        flow.notRecognized((msg, flow) => {
            knownSlots.depth -= 1
            msg.slots = []
            return require('./index').getNavigationTime(msg, flow, knownSlots)
        })

        flow.continue('snips-assistant:GetNavigationTime', (msg, flow) => {
            if (msg.intent.confidenceScore < INTENT_FILTER_PROBABILITY_THRESHOLD) {
                throw new Error('intentNotRecognized')
            }

            let slotsToBeSent = {
                travel_mode: travelMode,
                depth: knownSlots.depth - 1
            }

            // Adding the location_from, if any
            if (!slot.missing(locationFrom)) {
                slotsToBeSent.location_from = locationFrom
            }
            if (!slot.missing(locationTo)) {
                slotsToBeSent.location_to = locationTo
            }

            return require('./index').getNavigationTime(msg, flow, slotsToBeSent)
        })

        flow.continue('snips-assistant:Cancel', (_, flow) => {
            flow.end()
        })
        flow.continue('snips-assistant:Stop', (_, flow) => {
            flow.end()
        })

        if (slot.missing(locationFrom) && slot.missing(locationTo)) {
            throw new Error('intentNotRecognized')
        }
        if (slot.missing(locationFrom)) {
            return i18n('directions.dialog.noOriginAddress')
        }
        if (slot.missing(locationTo)) {
            return i18n('directions.dialog.noDestinationAddress')
        }
    } else {
        // Are the origin and destination addresses the same?
        if (locationFrom.includes(locationTo) || locationTo.includes(locationFrom)) {
            const speech = i18n('directions.dialog.sameLocations')
            flow.end()
            logger.info(speech)
            return speech
        }

        const now = Date.now()

        // Get the data from Directions API
        const directionsData = await directionsHttpFactory.calculateRoute({
            origin: locationFrom,
            destination: locationTo,
            travelMode
        })
        logger.debug(directionsData)

        try {
            const aggregatedDirectionsData = directions.aggregateDirections(directionsData)
            logger.debug(aggregatedDirectionsData)

            const { origin, destination } = directions.getFullAddress(locationFrom, locationTo, directionsData)
            const duration = directionsData.routes[0].legs[0].duration.value

            let durationInTraffic
            if (travelMode === 'driving') {
                durationInTraffic = directionsData.routes[0].legs[0].duration_in_traffic.value
            }
            
            const speech = translation.navigationTimeToSpeech(origin, destination, travelMode, duration, aggregatedDirectionsData, durationInTraffic)
            logger.info(speech)

            flow.end()
            if (Date.now() - now < 4000) {
                return speech
            } else {
                tts.say(speech)
            }
        } catch (error) {
            logger.error(error)
            throw new Error('APIResponse')
        }
    }
}
