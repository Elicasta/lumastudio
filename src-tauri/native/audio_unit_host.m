#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import <AudioUnit/AUCocoaUIView.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AudioUnit/AudioUnit.h>

typedef struct {
    AudioUnit unit;
    AudioComponentDescription desc;
    Float64 sampleTime;
    UInt32 maxFrames;
    void *editorWindow;
    const Float32 *inputLeft;
    const Float32 *inputRight;
    UInt32 inputFrames;
    UInt32 inputOffset;
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

static OSStatus luma_effect_input_callback(
    void *inRefCon,
    AudioUnitRenderActionFlags *ioActionFlags,
    const AudioTimeStamp *inTimeStamp,
    UInt32 inBusNumber,
    UInt32 inNumberFrames,
    AudioBufferList *ioData
) {
    LumaAUInstance *instance = (LumaAUInstance *)inRefCon;
    if (!instance || !ioData) return kAudio_ParamError;

    UInt32 available = 0;
    if (instance->inputOffset < instance->inputFrames) {
        available = MIN(
            inNumberFrames,
            instance->inputFrames - instance->inputOffset
        );
    }

    for (UInt32 bufferIndex = 0; bufferIndex < ioData->mNumberBuffers; bufferIndex++) {
        AudioBuffer *buffer = &ioData->mBuffers[bufferIndex];
        Float32 *destination = (Float32 *)buffer->mData;
        if (!destination) continue;

        const Float32 *source =
            bufferIndex == 0 ? instance->inputLeft : instance->inputRight;

        if (source && available > 0) {
            memcpy(
                destination,
                source + instance->inputOffset,
                available * sizeof(Float32)
            );
        }
        if (available < inNumberFrames) {
            memset(
                destination + available,
                0,
                (inNumberFrames - available) * sizeof(Float32)
            );
        }
        buffer->mDataByteSize = inNumberFrames * sizeof(Float32);
    }

    instance->inputOffset += available;
    return noErr;
}

static void luma_fill_stereo_format(
    AudioStreamBasicDescription *format,
    double sampleRate
) {
    memset(format, 0, sizeof(*format));
    format->mSampleRate = sampleRate;
    format->mFormatID = kAudioFormatLinearPCM;
    format->mFormatFlags =
        kAudioFormatFlagIsFloat |
        kAudioFormatFlagIsNonInterleaved |
        kAudioFormatFlagsNativeEndian;
    format->mBytesPerPacket = sizeof(Float32);
    format->mFramesPerPacket = 1;
    format->mBytesPerFrame = sizeof(Float32);
    format->mChannelsPerFrame = 2;
    format->mBitsPerChannel = 32;
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

    AudioStreamBasicDescription format;
    luma_fill_stereo_format(&format, sampleRate);

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

LumaAUInstance *luma_au_create_effect(
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

    LumaAUInstance *instance = calloc(1, sizeof(LumaAUInstance));
    if (!instance) {
        AudioComponentInstanceDispose(unit);
        if (outStatus) *outStatus = memFullErr;
        return NULL;
    }
    instance->unit = unit;
    instance->desc = desc;
    instance->sampleTime = 0.0;
    instance->maxFrames = maxFrames > 0 ? maxFrames : 4096;

    AudioStreamBasicDescription format;
    luma_fill_stereo_format(&format, sampleRate);

    status = AudioUnitSetProperty(
        unit,
        kAudioUnitProperty_StreamFormat,
        kAudioUnitScope_Input,
        0,
        &format,
        sizeof(format)
    );
    if (status == noErr) {
        status = AudioUnitSetProperty(
            unit,
            kAudioUnitProperty_StreamFormat,
            kAudioUnitScope_Output,
            0,
            &format,
            sizeof(format)
        );
    }

    UInt32 safeMaxFrames = instance->maxFrames;
    if (status == noErr) {
        AudioUnitSetProperty(
            unit,
            kAudioUnitProperty_MaximumFramesPerSlice,
            kAudioUnitScope_Global,
            0,
            &safeMaxFrames,
            sizeof(safeMaxFrames)
        );

        AURenderCallbackStruct callback = {
            .inputProc = luma_effect_input_callback,
            .inputProcRefCon = instance
        };
        status = AudioUnitSetProperty(
            unit,
            kAudioUnitProperty_SetRenderCallback,
            kAudioUnitScope_Input,
            0,
            &callback,
            sizeof(callback)
        );
    }

    if (status == noErr) {
        status = AudioUnitInitialize(unit);
    }

    if (status != noErr) {
        AudioComponentInstanceDispose(unit);
        free(instance);
        if (outStatus) *outStatus = status;
        return NULL;
    }

    if (outStatus) *outStatus = noErr;
    return instance;
}

void luma_au_destroy(LumaAUInstance *instance) {
    if (!instance) return;

    if (instance->editorWindow) {
        NSWindow *window = (__bridge_transfer NSWindow *)instance->editorWindow;
        instance->editorWindow = NULL;
        void (^closeWindow)(void) = ^{
            [window close];
        };
        if ([NSThread isMainThread]) closeWindow();
        else dispatch_async(dispatch_get_main_queue(), closeWindow);
    }

    if (instance->unit) {
        AudioUnitUninitialize(instance->unit);
        AudioComponentInstanceDispose(instance->unit);
    }
    free(instance);
}

int32_t luma_au_open_editor(LumaAUInstance *instance) {
    if (!instance || !instance->unit) return kAudio_ParamError;

    __block OSStatus result = noErr;
    void (^openEditor)(void) = ^{
        if (instance->editorWindow) {
            NSWindow *existing = (__bridge NSWindow *)instance->editorWindow;
            [existing makeKeyAndOrderFront:nil];
            return;
        }

        UInt32 size = 0;
        Boolean writable = false;
        OSStatus status = AudioUnitGetPropertyInfo(
            instance->unit,
            kAudioUnitProperty_CocoaUI,
            kAudioUnitScope_Global,
            0,
            &size,
            &writable
        );
        if (status != noErr || size < sizeof(AudioUnitCocoaViewInfo)) {
            result = status != noErr ? status : kAudio_ParamError;
            return;
        }

        AudioUnitCocoaViewInfo *info = (AudioUnitCocoaViewInfo *)malloc(size);
        if (!info) {
            result = memFullErr;
            return;
        }

        status = AudioUnitGetProperty(
            instance->unit,
            kAudioUnitProperty_CocoaUI,
            kAudioUnitScope_Global,
            0,
            info,
            &size
        );
        if (status != noErr) {
            free(info);
            result = status;
            return;
        }

        CFBundleRef bundle = CFBundleCreate(
            kCFAllocatorDefault,
            info->mCocoaAUViewBundleLocation
        );
        if (!bundle || !CFBundleLoadExecutable(bundle)) {
            if (bundle) CFRelease(bundle);
            free(info);
            result = kAudio_ParamError;
            return;
        }

        NSString *className = (__bridge NSString *)info->mCocoaAUViewClass[0];
        Class factoryClass = NSClassFromString(className);
        id factory = factoryClass ? [[factoryClass alloc] init] : nil;
        NSView *view = nil;
        if (factory && [factory conformsToProtocol:@protocol(AUCocoaUIBase)]) {
            view = [(id<AUCocoaUIBase>)factory
                uiViewForAudioUnit:instance->unit
                withSize:NSMakeSize(0, 0)];
        }

        if (!view) {
            CFRelease(bundle);
            free(info);
            result = kAudio_ParamError;
            return;
        }

        NSSize preferred = view.fittingSize;
        if (preferred.width < 320) preferred.width = MAX(640, view.frame.size.width);
        if (preferred.height < 200) preferred.height = MAX(480, view.frame.size.height);

        NSWindow *window = [[NSWindow alloc]
            initWithContentRect:NSMakeRect(0, 0, preferred.width, preferred.height)
            styleMask:(NSWindowStyleMaskTitled |
                       NSWindowStyleMaskClosable |
                       NSWindowStyleMaskResizable |
                       NSWindowStyleMaskMiniaturizable)
            backing:NSBackingStoreBuffered
            defer:NO];

        window.title = @"LumaStudio Instrument";
        window.contentView = view;
        [window center];
        [window makeKeyAndOrderFront:nil];
        instance->editorWindow = (__bridge_retained void *)window;

        CFRelease(bundle);
        free(info);
    };

    if ([NSThread isMainThread]) openEditor();
    else dispatch_sync(dispatch_get_main_queue(), openEditor);

    return result;
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

    struct {
        UInt32 mNumberBuffers;
        AudioBuffer mBuffers[2];
    } buffers = {0};

    buffers.mNumberBuffers = 2;
    buffers.mBuffers[0].mNumberChannels = 1;
    buffers.mBuffers[0].mDataByteSize = frames * sizeof(Float32);
    buffers.mBuffers[0].mData = left;
    buffers.mBuffers[1].mNumberChannels = 1;
    buffers.mBuffers[1].mDataByteSize = frames * sizeof(Float32);
    buffers.mBuffers[1].mData = right;

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
        (AudioBufferList *)&buffers
    );
    if (status == noErr) {
        instance->sampleTime += frames;
    }
    return status;
}

int32_t luma_au_render_effect(
    LumaAUInstance *instance,
    UInt32 frames,
    const Float32 *inputLeft,
    const Float32 *inputRight,
    Float32 *outputLeft,
    Float32 *outputRight
) {
    if (!instance || !inputLeft || !inputRight || !outputLeft || !outputRight) {
        return kAudio_ParamError;
    }
    instance->inputLeft = inputLeft;
    instance->inputRight = inputRight;
    instance->inputFrames = frames;
    instance->inputOffset = 0;

    OSStatus status = luma_au_render(
        instance,
        frames,
        outputLeft,
        outputRight
    );

    instance->inputLeft = NULL;
    instance->inputRight = NULL;
    instance->inputFrames = 0;
    instance->inputOffset = 0;
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
