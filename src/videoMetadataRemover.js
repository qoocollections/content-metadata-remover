// @flow
/* eslint-disable no-await-in-loop */
import base64 from 'Base64'

import { readNextChunkIntoDataView, getEncodedWipeoutString } from './metaRemoverHelpers'
import type { ReadFunction, WriteFunction } from './metaRemoverHelpers'

// remove gps & datetime
// you can added to keys
const TAG_TO_STRIP_ARRAY = ['com.apple.quicktime.location.ISO6709', 'com.apple.quicktime.creationdate']

const USER_META_TAG = 'udta' // if udta hav meta tag, remove all meta value
const META_ATOM_TAG = 'meta'
const UUID_TAG = 'uuid'
const XMP_TAG = 'XMP_'
const XYZ_TAG = '©xyz'
const HEADER_TAGS = ['mvhd', 'tkhd', 'mdhd'] // tag related datetime
const TAGS_TO_ENTER: Array<string> = ['moov', 'trak', 'mdia'] // non skip tag

const wipeData = async (
    sizeToRemove: number,
    offset: number,
    write: WriteFunction,
    read: ReadFunction,
    suppliedWipeoutString: string = ''
): Promise<void> => {
  //NEXT LINES FOR DEBUG - take out
  const dataToWipe = await readNextChunkIntoDataView(sizeToRemove, offset, read)
  console.log('data to wipe', dataToWipe.getString(sizeToRemove, 0))
  suppliedWipeoutString = Array(sizeToRemove + 1).join(String.fromCharCode(0))
  let encodedWipeoutString = await getEncodedWipeoutString(sizeToRemove)
  if(encodedWipeoutString.length !== dataToWipe.length) {
    // difference size would make the broken file
    encodedWipeoutString = await getEncodedWipeoutString(sizeToRemove)
    await write(suppliedWipeoutString, offset, 'ascii')
  }else {
    await write(encodedWipeoutString, offset, 'base64')
  }
}

export const videoMetadataRemoverSkip
    = async (read: ReadFunction, write: WriteFunction, skipXMPRemoval: boolean): Promise<boolean> => {
  console.log('preparing to read video skip...')
  let stopSearching = false
  // eslint-disable-next-line new-cap
  let offset = 0
  while (
      !stopSearching
      ) {
    console.log('reading next tag in video...')
    const dataView = await readNextChunkIntoDataView(8, offset, read)
    // an atom must have a length of at least 8
    console.log('tag bite + length', dataView.buffer, dataView.byteLength)
    if (dataView.byteLength === 0) {
      stopSearching = true
      break
    }
    if (dataView.byteLength >= 8) {
      const tagLength = dataView.getUint32(0)
      const tagName = dataView.getString(4, 4)
      console.log('found tag', tagName, tagLength)
      if(tagLength === 0) {
        stopSearching = true
        break
      }
      if (tagName === META_ATOM_TAG) {
        console.log('found meta tag in video', tagLength)
        const metaTagDataView = await readNextChunkIntoDataView(tagLength, offset, read)
        console.log('meta buffer', metaTagDataView)
        const metaBaseOffset = 0
        const hdlrSize = metaTagDataView.getUint32(metaBaseOffset + 8)
        const keyOffset = metaBaseOffset + hdlrSize + 8
        const keySectionSize = metaTagDataView.getUint32(keyOffset)
        const keyEntryCount = metaTagDataView.getUint32(keyOffset + 12)
        let currentKeyOffset = keyOffset + 16
        let currentKey = 0
        let indexOfTagToStrips = []
        while (currentKey < keyEntryCount) {
          const currentKeySize = metaTagDataView.getUint32(currentKeyOffset)
          const currentKeyName = metaTagDataView.getString(
              currentKeySize - 8,
              currentKeyOffset + 8
          )
          console.log('finding keys', currentKeyName, currentKeySize)
          if (TAG_TO_STRIP_ARRAY.includes(currentKeyName)) {
            indexOfTagToStrips.push(currentKey)
          }
          currentKeyOffset += currentKeySize
          currentKey++
        }

        console.log("indexOfTagToStrips " + JSON.stringify(indexOfTagToStrips));

        if (indexOfTagToStrips.length > 0) {
          const itemsOffset = keyOffset + keySectionSize
          let currentItemOffset = itemsOffset + 8;

          for(let itemIndex = 0; itemIndex < keyEntryCount; itemIndex ++){
            console.log("itemIndex : " + itemIndex);
            if(indexOfTagToStrips.includes(itemIndex)){
              const offsetOfSizeToRemove = currentItemOffset + 8
              const sizeToRemove = metaTagDataView.getUint32(offsetOfSizeToRemove) - 8
              const offsetOfDataToRemove = offsetOfSizeToRemove + 8
              await wipeData(sizeToRemove, offsetOfDataToRemove + offset, write, read)
            }

            const currentItemSize = metaTagDataView.getUint32(currentItemOffset)
            currentItemOffset += currentItemSize
          }
        }
        offset += tagLength

      } else if ( tagName === USER_META_TAG ) {
        let udtaOffset = offset + 8 ;
        let udtaEndOffSet = offset + tagLength;
        while (udtaOffset < udtaEndOffSet){
          const udtaTagData = await readNextChunkIntoDataView(8, udtaOffset, read)
          if(udtaTagData.byteLength === 0 ){
            break
          } else{
            const currentKeyLength = udtaTagData.getUint32(0)
            const currentKeyName = udtaTagData.getString(4, 4)
            if(currentKeyName === 'meta') {
              await wipeData(currentKeyLength - 8, udtaOffset + 8, write, read)
              break;
            }
            udtaOffset += 8;
          }
        }
        offset += tagLength;

      } else if (TAGS_TO_ENTER.includes(tagName)) {
        console.log('moov or udta tag found')
        offset += 8
      } else if ((tagName === UUID_TAG || tagName === XMP_TAG) && !skipXMPRemoval) {
        // XMP is an alternative tag format pushed by adobe that can have gps
        // (can also be id'd by UUID atom)
        // we just want to wipe it
        console.log('found uuid tag')
        await wipeData(tagLength - 8, offset + 8, write, read)
        offset += tagLength
      } else if ( HEADER_TAGS.includes(tagName) ){
        // XMP is an alternative tag format pushed by adobe that can have gps
        // (can also be id'd by UUID atom)
        // we just want to wipe it
        console.log('found uuid tag')
        // tag 길이가 4byte 길이가 8 modifyTime 4 createTime 4
        await wipeData(8, offset + 12, write, read)
        offset += tagLength
      } else if (tagName === XYZ_TAG) {
        // ©xyz is an alternative gps tag format that some android phones use
        console.log('found xyz tag')
        const xyzDataView = await readNextChunkIntoDataView(tagLength, offset, read)
        const xyzString = xyzDataView.getString(tagLength, 0)
        console.log('xyz data', xyzString)
        const plusIndex = xyzString.indexOf('+')
        const slashIndex = xyzString.indexOf('/')
        if (
            plusIndex >= 0
            && slashIndex >=0
            && plusIndex < slashIndex
        ) {
          const dataString = xyzString.substring(plusIndex, slashIndex)
          const wipeoutString = dataString.replace(/[0-9]/g, "0")
          console.log('xyz wipeout string', dataString, wipeoutString)
          await wipeData(wipeoutString.length, offset + plusIndex, write, read, wipeoutString)
        } else {
          console.log('xyz data was malformed, skipping')
          offset += tagLength
        }
        // 10 = 8 byte tag lenght + tag, 2 byte internal length of xyz data
        //await wipeData(tagLength - 12, offset + 12, write, read)
      }
      else {
        offset += tagLength
      }
    }
  }
  console.log('exiting video skip remover')
  return true
}
