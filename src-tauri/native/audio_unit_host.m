#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AudioUnit/AudioUnit.h>

typedef struct {
    AudioUnit unit;
    AudioComponentDescription desc;
    Float64 sampleTime;
    UInt32 maxFrames;
} LumaAUInstance;

static char *copy_utf8(NSString *value) {
    if (!value) return NULL;
    const char *utf8 = [value UTF8String];
    if (!utf8) return NULL;
    size_t length = strlen(utf8);
    char *copy = (char *)malloc(length + 1);
    if (!copy) return NULL;
    memcpy(copy, utf8, length + 1);
    return copy;
}

static NSString *fourcc_string(OSType value) {
    char chars[5] = {
        (char)((value >> 24) & 0xff),
        (char)((value >> 16) & 0xff),
        (char)((value >> 8) & 0xff),
        (char)(value & 0xff),
        0
    };
    for (int i = 0; i < 4; i++) {
        if (chars[i] < 32 || chars[i] > 126) chars[i] = '?';
    }
    return [NSString stringWithUTF8String:chars];
}

char *luma_au_scan_json(void) {
    @autoreleasepool {
        AVAudioUnitComponentManager *manager =
            [AVAudioUnitComponentManager sharedAudioUnitComponentManager];

        AudioComponentDescription any = {0};
        NSArray<AVAudioUnitComponent *> *components =
            [manager componentsMatchingDescription:any];

        NSMutableArray *result = [NSMutableArray array];

        for (AVAudioUnitComponent *component in components) {
            AudioComponentDescription desc = component.audioComponentDescription;
            BOOL supported =
                desc.componentType == kAudioUnitType_MusicDevice ||
                desc.componentType == kAudioUnitType_Effect ||
                desc.componentType == kAudioUnitType_MusicEffect ||
                desc.componentType == kAudioUnitType_Generator;
            if (!supported) continue;

            NSString *category = @"effect";
            if (desc.componentType == kAudioUnitType_MusicDevice) category = @"instrument";
            if (desc.componentType == kAudioUnitType_Generator) category = @"generator";
            if (desc.componentType == kAudioUnitType_MusicEffect) category = @"midi-effect";

            NSString *identifier = [NSString stringWithFormat:@"%@:%@:%@",
                fourcc_string(desc.componentType),
                fourcc_string(desc.componentSubType),
                fourcc_string(desc.componentManufacturer)];

            NSDictionary *item = @{
                @"identifier": identifier,
                @"name": component.name ?: @"Unknown Audio Unit",
                @"manufacturer": component.manufacturerName ?: @"Unknown",
                @"typeName": component.typeName ?: @"Audio Unit",
                @"version": component.versionString ?: @"",
                @"category": category,
                @"componentType": @(desc.componentType),
                @"componentSubType": @(desc.componentSubType),
                @"componentManufacturer": @(desc.componentManufacturer),
                @"hasCustomView": @(component.hasCustomView),
                @"sandboxSafe": @(component.isSandboxSafe)
            };
            [result addObject:item];
        }

        [result sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            NSComparisonResult manufacturer =
                [a[@"manufacturer"] localizedCaseInsensitiveCompare:b[@"manufacturer"]];
            if (manufacturer != NSOrderedSame) return manufacturer;
            return [a[@"name"] localizedCaseInsensitiveCompare:b[@"name"]];
        }];

        NSError *error = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
        if (!json || error) {
            return copy_utf8(@"[]");
        }

        NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
        return copy_utf8(text ?: @"[]");
    }
}

void luma_au_free_string(char *value) {
    if (value) free(value);
}

LumaAUInstance *luma_au_create(
    UInt32 componentType,
    UInt32 componentSubType,
    UInt32 componentManufacturer,
    double sampleRate,
    UInt32 maxFrames,
    int32_t *outStatus
) {
    AudioComponentDescription desc = {
        .componentType = componentType,
        .componentSubType = componentSubType,
        .componentManufacturer = componentManufacturer,
        .componentFlags = 0,
        .componentFlagsMask = 0
    };

    AudioComponent component = AudioComponentFindNext(NULL, &desc);
    if (!component) {
        if (outStatus) *outStatus = kAudio_ParamError;
        return NULL;
    }

    AudioUnit unit = NULL;
    OSStatus status = AudioComponentInstanceNew(component, &unit);
    if (status != noErr || !unit) {
        if (outStatus) *outStatus = status;
        return NULL;
    }

    AudioStreamBasicDescription format = {0};
    format.mSampleRate = sampleRate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags =
        kAudioFormatFlagIsFloat |
        kAudioFormatFlagIsNonInterleaved |
        kAudioFormatFlagsNativeEndian;
    format.mBytesPerPacket = sizeof(Float32);
    format.mFramesPerPacket = 1;
    format.mBytesPerFrame = sizeof(Float32);
    format.mChannelsPerFrame = 2;
    format.mBitsPerChannel = 32;

    status = AudioUnitSetProperty(
        unit,
        kAudioUnitProperty_StreamFormat,
        kAudioUnitScope_Output,
        0,
        &format,
        sizeof(format)
    );
    if (status != noErr) {
        AudioComponentInstanceDispose(unit);
        if (outStatus) *outStatus = status;
        return NULL;
    }

    UInt32 safeMaxFrames = maxFrames > 0 ? maxFrames : 4096;
    AudioUnitSetProperty(
        unit,
        kAudioUnitProperty_MaximumFramesPerSlice,
        kAudioUnitScope_Global,
        0,
        &safeMaxFrames,
        sizeof(safeMaxFrames)
    );

    status = AudioUnitInitialize(unit);
    if (status != noErr) {
        AudioComponentInstanceDispose(unit);
        if (outStatus) *outStatus = status;
        return NULL;
    }

    LumaAUInstance *instance = calloc(1, sizeof(LumaAUInstance));
    if (!instance) {
        AudioUnitUninitialize(unit);
        AudioComponentInstanceDispose(unit);
        if (outStatus) *outStatus = memFullErr;
        return NULL;
    }

    instance->unit = unit;
    instance->desc = desc;
    instance->sampleTime = 0.0;
    instance->maxFrames = safeMaxFrames;
    if (outStatus) *outStatus = noErr;
    return instance;
}

void luma_au_destroy(LumaAUInstance *instance) {
    if (!instance) return;
    if (instance->unit) {
        AudioUnitUninitialize(instance->unit);
        AudioComponentInstanceDispose(instance->unit);
    }
    free(instance);
}

int32_t luma_au_send_midi(
    LumaAUInstance *instance,
    UInt32 status,
    UInt32 data1,
    UInt32 data2,
    UInt32 sampleOffset
) {
    if (!instance || !instance->unit) return kAudio_ParamError;
    return MusicDeviceMIDIEvent(
        instance->unit,
        status & 0xff,
        data1 & 0x7f,
        data2 & 0x7f,
        sampleOffset
    );
}

int32_t luma_au_render(
    LumaAUInstance *instance,
    UInt32 frames,
    Float32 *left,
    Float32 *right
) {
    if (!instance || !instance->unit || !left || !right || frames == 0) {
        return kAudio_ParamError;
    }
    if (frames > instance->maxFrames) return kAudio_ParamError;

    AudioBufferList *list =
        (AudioBufferList *)calloc(1, offsetof(AudioBufferList, mBuffers) + sizeof(AudioBuffer) * 2);
    if (!list) return memFullErr;

    list->mNumberBuffers = 2;
    list->mBuffers[0].mNumberChannels = 1;
    list->mBuffers[0].mDataByteSize = frames * sizeof(Float32);
    list->mBuffers[0].mData = left;
    list->mBuffers[1].mNumberChannels = 1;
    list->mBuffers[1].mDataByteSize = frames * sizeof(Float32);
    list->mBuffers[1].mData = right;

    memset(left, 0, frames * sizeof(Float32));
    memset(right, 0, frames * sizeof(Float32));

    AudioTimeStamp timestamp = {0};
    timestamp.mSampleTime = instance->sampleTime;
    timestamp.mFlags = kAudioTimeStampSampleTimeValid;
    AudioUnitRenderActionFlags flags = 0;

    OSStatus status = AudioUnitRender(
        instance->unit,
        &flags,
        &timestamp,
        0,
        frames,
        list
    );

    free(list);
    if (status == noErr) {
        instance->sampleTime += frames;
    }
    return status;
}

char *luma_au_parameters_json(LumaAUInstance *instance) {
    @autoreleasepool {
        if (!instance || !instance->unit) return copy_utf8(@"[]");

        UInt32 size = 0;
        Boolean writable = false;
        OSStatus status = AudioUnitGetPropertyInfo(
            instance->unit,
            kAudioUnitProperty_ParameterList,
            kAudioUnitScope_Global,
            0,
            &size,
            &writable
        );
        if (status != noErr || size == 0) return copy_utf8(@"[]");

        UInt32 count = size / sizeof(AudioUnitParameterID);
        AudioUnitParameterID *ids = malloc(size);
        if (!ids) return copy_utf8(@"[]");

        status = AudioUnitGetProperty(
            instance->unit,
            kAudioUnitProperty_ParameterList,
            kAudioUnitScope_Global,
            0,
            ids,
            &size
        );
        if (status != noErr) {
            free(ids);
            return copy_utf8(@"[]");
        }

        NSMutableArray *result = [NSMutableArray arrayWithCapacity:count];

        for (UInt32 i = 0; i < count; i++) {
            AudioUnitParameterInfo info = {0};
            UInt32 infoSize = sizeof(info);
            status = AudioUnitGetProperty(
                instance->unit,
                kAudioUnitProperty_ParameterInfo,
                kAudioUnitScope_Global,
                ids[i],
                &info,
                &infoSize
            );
            if (status != noErr) continue;

            NSString *name = nil;
            if ((info.flags & kAudioUnitParameterFlag_HasCFNameString) && info.cfNameString) {
                name = (__bridge NSString *)info.cfNameString;
            }
            if (!name) {
                name = [NSString stringWithUTF8String:info.name] ?: [NSString stringWithFormat:@"Parameter %u", ids[i]];
            }

            AudioUnitParameterValue value = info.defaultValue;
            AudioUnitGetParameter(
                instance->unit,
                ids[i],
                kAudioUnitScope_Global,
                0,
                &value
            );

            [result addObject:@{
                @"id": @(ids[i]),
                @"name": name,
                @"min": @(info.minValue),
                @"max": @(info.maxValue),
                @"defaultValue": @(info.defaultValue),
                @"value": @(value),
                @"unit": @(info.unit),
                @"flags": @(info.flags)
            }];

            if ((info.flags & kAudioUnitParameterFlag_CFNameRelease) && info.cfNameString) {
                CFRelease(info.cfNameString);
            }
        }

        free(ids);

        NSError *error = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
        if (!json || error) return copy_utf8(@"[]");

        NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
        return copy_utf8(text ?: @"[]");
    }
}

int32_t luma_au_set_parameter(
    LumaAUInstance *instance,
    UInt32 parameterID,
    Float32 value
) {
    if (!instance || !instance->unit) return kAudio_ParamError;
    return AudioUnitSetParameter(
        instance->unit,
        parameterID,
        kAudioUnitScope_Global,
        0,
        value,
        0
    );
}

char *luma_au_save_state(LumaAUInstance *instance) {
    @autoreleasepool {
        if (!instance || !instance->unit) return NULL;

        CFPropertyListRef state = NULL;
        UInt32 size = sizeof(state);
        OSStatus status = AudioUnitGetProperty(
            instance->unit,
            kAudioUnitProperty_ClassInfo,
            kAudioUnitScope_Global,
            0,
            &state,
            &size
        );
        if (status != noErr || !state) return NULL;

        NSError *error = nil;
        NSData *data = [NSPropertyListSerialization
            dataWithPropertyList:(__bridge id)state
            format:NSPropertyListBinaryFormat_v1_0
            options:0
            error:&error];

        CFRelease(state);
        if (!data || error) return NULL;

        NSString *encoded = [data base64EncodedStringWithOptions:0];
        return copy_utf8(encoded);
    }
}

int32_t luma_au_load_state(LumaAUInstance *instance, const char *base64) {
    @autoreleasepool {
        if (!instance || !instance->unit || !base64) return kAudio_ParamError;

        NSString *encoded = [NSString stringWithUTF8String:base64];
        NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
        if (!data) return kAudio_ParamError;

        NSError *error = nil;
        id plist = [NSPropertyListSerialization
            propertyListWithData:data
            options:NSPropertyListImmutable
            format:NULL
            error:&error];
        if (!plist || error) return kAudio_ParamError;

        CFPropertyListRef state = (__bridge CFPropertyListRef)plist;
        OSStatus status = AudioUnitSetProperty(
            instance->unit,
            kAudioUnitProperty_ClassInfoFromDocument,
            kAudioUnitScope_Global,
            0,
            &state,
            sizeof(state)
        );

        if (status != noErr) {
            status = AudioUnitSetProperty(
                instance->unit,
                kAudioUnitProperty_ClassInfo,
                kAudioUnitScope_Global,
                0,
                &state,
                sizeof(state)
            );
        }

        return status;
    }
}
